#pragma once

// Serialized asynchronous access to one MuPDFDocument.
//
// MuPDF's threading model permits parallel *rendering* only when each thread
// has its own context and display lists are prepared under a lock. It never
// permits two threads inside the same fz_document. This executor is the single
// point where that is enforced: one worker thread, one queue, one document.
//
// Lifetime is the other half of the job. Jobs must not capture a raw `this`
// from the owning HybridObject -- the JS side can drop the object while a
// render is in flight. Every job instead holds a shared_ptr to the State below,
// so the document outlives the work queued against it, and close() invalidates
// pending work rather than racing it.

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "MuPDFDocument.h"

namespace nitroflipper::mupdf {

/**
 * Owns the document and the thread that is allowed to touch it.
 *
 * Construct with make(); the returned shared_ptr is what jobs capture.
 */
class DocumentExecutor : public std::enable_shared_from_this<DocumentExecutor> {
 public:
  static std::shared_ptr<DocumentExecutor> make(
      std::size_t storeBudgetBytes = MuPDFDocument::kDefaultStoreBudget);

  ~DocumentExecutor();

  DocumentExecutor(const DocumentExecutor&) = delete;
  DocumentExecutor& operator=(const DocumentExecutor&) = delete;

  /**
   * Queue `work` and get a future for its result.
   *
   * `work` runs on the worker thread with exclusive access to the document.
   * If shutdown has begun the future is satisfied with a Cancelled Error rather
   * than never settling -- an unsettled promise is a hung reader.
   */
  template <class R>
  std::future<R> submit(std::function<R(MuPDFDocument&)> work);

  /**
   * Stop accepting work, abandon what is queued, and join the thread.
   *
   * Queued jobs are settled with Cancelled. The job already running is allowed
   * to finish: interrupting it mid-fz_call would leave fitz state inconsistent.
   * Long scans cooperate through cancellationToken() instead.
   *
   * Idempotent, and safe to call from the destructor.
   */
  void shutdown() noexcept;

  /**
   * Polled by long-running work (search, whole-document scans) so it can bail
   * out when a close arrives. Returns false once shutdown has begun.
   */
  std::function<bool()> cancellationToken();

  /** Generation counters as of the last completed job. Cheap, lock-free read. */
  Generations publishedGenerations() const noexcept;

  /** The last snapshot published by a completed job. Cheap to read from JS. */
  Snapshot publishedSnapshot() const;

 private:
  DocumentExecutor() = default;
  void start(std::size_t storeBudgetBytes);
  void run();
  void publish(const Snapshot& snapshot);

  using Job = std::function<void()>;

  std::unique_ptr<MuPDFDocument> document_;
  std::thread worker_;

  mutable std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<Job> queue_;
  bool stopping_ = false;

  mutable std::mutex snapshotMutex_;
  Snapshot snapshot_;

  // Read without the queue lock by cancellationToken's closure and by
  // publishedGenerations, both of which are called from other threads.
  std::atomic<bool> cancelled_{false};
  std::atomic<std::uint64_t> publishedDocGeneration_{0};
  std::atomic<std::uint64_t> publishedLayoutGeneration_{0};
};

template <class R>
std::future<R> DocumentExecutor::submit(std::function<R(MuPDFDocument&)> work) {
  auto promise = std::make_shared<std::promise<R>>();
  std::future<R> future = promise->get_future();

  // The job holds the executor alive for its own duration, so a JS-side release
  // during a render cannot destroy the document underneath it.
  auto self = shared_from_this();
  Job job = [self, promise, work = std::move(work)]() mutable {
    // Checked inside the job, not only at submit time: shutdown can arrive
    // after this job was queued but before it runs. Without this an abandoned
    // job would call into a document that close() has already released.
    if (self->cancelled_.load(std::memory_order_acquire)) {
      promise->set_exception(std::make_exception_ptr(
          Error(ErrorKind::Cancelled, "document closed before this job ran")));
      return;
    }
    try {
      if constexpr (std::is_void_v<R>) {
        work(*self->document_);
        self->publish(self->document_->snapshot());
        promise->set_value();
      } else {
        R result = work(*self->document_);
        self->publish(self->document_->snapshot());
        promise->set_value(std::move(result));
      }
    } catch (...) {
      promise->set_exception(std::current_exception());
    }
  };

  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (stopping_) {
      // Settle now. A promise that is never satisfied leaves the JS await
      // pending forever, which shows up as a reader stuck on its spinner.
      promise->set_exception(std::make_exception_ptr(
          Error(ErrorKind::Cancelled, "document executor is shutting down")));
      return future;
    }
    queue_.push_back(std::move(job));
  }
  cv_.notify_one();
  return future;
}

}  // namespace nitroflipper::mupdf
