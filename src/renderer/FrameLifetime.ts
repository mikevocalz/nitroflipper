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

  stage(release: () => void): number {
    const revision = this.nextRevision++;
    this.releases.set(revision, release);
    return revision;
  }

  recorded(revision: number): void {
    if (revision <= this.recordedRevision) return;
    this.recordedRevision = revision;
    for (const [id, release] of this.releases) {
      if (id < revision) {
        this.releases.delete(id);
        release();
      }
    }
  }

  discard(revision: number): void {
    const release = this.releases.get(revision);
    this.releases.delete(revision);
    release?.();
  }

  clear(): void {
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }
}
