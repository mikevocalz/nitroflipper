/**
 * Retire a frame only after its successor's native paint has been built.
 * React commits and JS requestAnimationFrame callbacks are not render fences.
 * The paint owns its native shader/image references independently. This is a
 * resource handoff, not a claim that SurfaceFlinger has presented the frame.
 */
export class FrameLifetime {
  private nextRevision = 1;
  private recordedRevision = 0;
  private releases = new Map<number, () => void>();
  private held = new Set<number>();

  stage(release: () => void): number {
    const revision = this.nextRevision++;
    this.releases.set(revision, release);
    return revision;
  }

  /**
   * Keep a revision out of the sweep until it is taken or thrown away.
   *
   * A landing frame is staged ahead of the turn and then held by the UI
   * runtime, which will show it the moment a flick commits. Meanwhile the
   * loader keeps rebuilding the *current* frame as neighbours arrive, and each
   * rebuild takes a newer revision than the landing already has. Revision
   * order therefore says nothing about whether anything still points at it:
   * sweeping on `id < revision` alone frees a frame the reader is one gesture
   * away from drawing, and Skia throws on the disposed shaders.
   */
  hold(revision: number): void {
    this.held.add(revision);
  }

  /** The landing was taken and is now the displayed frame; sweep it normally. */
  taken(revision: number): void {
    this.held.delete(revision);
  }

  recorded(revision: number): void {
    if (revision <= this.recordedRevision) return;
    this.recordedRevision = revision;
    for (const [id, release] of this.releases) {
      if (id < revision && !this.held.has(id)) {
        this.releases.delete(id);
        release();
      }
    }
  }

  discard(revision: number): void {
    this.held.delete(revision);
    const release = this.releases.get(revision);
    this.releases.delete(revision);
    release?.();
  }

  clear(): void {
    for (const release of this.releases.values()) release();
    this.releases.clear();
    this.held.clear();
  }
}
