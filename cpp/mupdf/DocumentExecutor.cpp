#include "DocumentExecutor.h"

namespace nitroflipper::mupdf {

std::shared_ptr<DocumentExecutor> DocumentExecutor::make(std::size_t storeBudgetBytes) {
  // Not make_shared: the constructor is private, and a public one would let a
  // caller build an executor that enable_shared_from_this cannot serve.
  std::shared_ptr<DocumentExecutor> self(new DocumentExecutor());
  self->start(storeBudgetBytes);
  return self;
}

void DocumentExecutor::start(std::size_t storeBudgetBytes) {
  // Constructed on the caller's thread but only ever *used* on the worker.
  // fz_new_context has no thread affinity; fz_document does.
  document_ = std::make_shared<MuPDFDocument>(storeBudgetBytes);
  worker_ = std::thread([this] { run(); });
}

DocumentExecutor::~DocumentExecutor() {
  shutdown();
  // The document is destroyed here, on whichever thread released the last
  // reference, and only after the worker has joined -- so nothing else can be
  // inside fitz at this point.
  document_.reset();
}

void DocumentExecutor::run() {
  for (;;) {
    Job job;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      cv_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
      if (stopping_ && queue_.empty()) {
        return;
      }
      if (queue_.empty()) {
        continue;
      }
      job = std::move(queue_.front());
      queue_.pop_front();
    }
    // Run outside the lock: a render holds the worker for tens of
    // milliseconds, and submit() must not block the JS thread for that long.
    job();
  }
}

void DocumentExecutor::enqueue(std::function<void(MuPDFDocument*)> job,
                               std::function<void()> afterPublish) {
  // weak, not shared: see the note on document_. A strong reference here makes
  // the worker capable of destroying the executor, which self-joins.
  std::weak_ptr<DocumentExecutor> weak = weak_from_this();
  auto document = document_;

  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!stopping_) {
      queue_.push_back([weak, document, job, afterPublish]() {
        auto self = weak.lock();
        if (!self) {
          job(nullptr);
          if (afterPublish) afterPublish();
          return;
        }
        // nullptr tells the job the document is gone. Re-checked here rather
        // than only at enqueue time, because shutdown can land in between.
        if (self->cancelled_.load(std::memory_order_acquire)) {
          job(nullptr);
          if (afterPublish) afterPublish();
          return;
        }
        job(document.get());
        // Publish before the continuation runs, so anything the JS side reads
        // synchronously after its promise settles sees this job's state.
        self->publish(document->snapshot());
        if (afterPublish) afterPublish();
      });
      cv_.notify_one();
      return;
    }
  }

  // Already shutting down. Invoke the job now, on the calling thread, with
  // nullptr -- dropping it would leave whatever is waiting on it pending
  // forever. Deliberately outside the lock: the job settles a promise, and a
  // promise continuation can run arbitrary code.
  job(nullptr);
  if (afterPublish) afterPublish();
}

void DocumentExecutor::shutdown() noexcept {
  std::deque<Job> abandoned;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (stopping_) {
      return;
    }
    stopping_ = true;
    // Take the queue under the lock but settle the promises outside it: a
    // promise's continuation can run arbitrary code, and doing that while
    // holding the queue lock is how this deadlocks against submit().
    abandoned.swap(queue_);
  }
  cancelled_.store(true, std::memory_order_release);
  cv_.notify_all();

  // Each abandoned job settles its own promise through the catch in submit()'s
  // lambda; running it here would touch the document after shutdown. Instead
  // drop them, which destroys the captured promise and breaks the future with
  // broken_promise -- so we run them under a flag the job itself observes.
  for (auto& job : abandoned) {
    // Marking cancelled_ before this means the job's work() is never called;
    // the lambda settles the promise with Cancelled via the throw below.
    try {
      job();
    } catch (...) {
      // A job never throws out of itself -- it captures into the promise.
    }
  }

  if (worker_.joinable()) {
    worker_.join();
  }
}

std::function<bool()> DocumentExecutor::cancellationToken() {
  // Captures a weak_ptr, not this: the token outlives the executor when a
  // search is still unwinding.
  std::weak_ptr<DocumentExecutor> weak = weak_from_this();
  return [weak]() -> bool {
    auto self = weak.lock();
    if (!self) {
      return false;
    }
    return !self->cancelled_.load(std::memory_order_acquire);
  };
}

void DocumentExecutor::publish(const Snapshot& snapshot) {
  {
    std::lock_guard<std::mutex> lock(snapshotMutex_);
    snapshot_ = snapshot;
  }
  // Published after the snapshot so a reader that sees a new generation is
  // guaranteed to find the matching snapshot.
  publishedDocGeneration_.store(snapshot.generations.document,
                                std::memory_order_release);
  publishedLayoutGeneration_.store(snapshot.generations.layout,
                                   std::memory_order_release);
}

Generations DocumentExecutor::publishedGenerations() const noexcept {
  Generations g;
  g.document = publishedDocGeneration_.load(std::memory_order_acquire);
  g.layout = publishedLayoutGeneration_.load(std::memory_order_acquire);
  return g;
}

Snapshot DocumentExecutor::publishedSnapshot() const {
  std::lock_guard<std::mutex> lock(snapshotMutex_);
  return snapshot_;
}

}  // namespace nitroflipper::mupdf
