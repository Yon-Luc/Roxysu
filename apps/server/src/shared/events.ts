export type AppEvent =
  | { type: "sync.finished"; importId: number }
  | { type: "score.imported"; scoreCount: number }
  | { type: "score.updated" }
  | { type: "session.started"; sessionId: number }
  | { type: "session.finished"; sessionId: number }
  | { type: "mastery.updated" }
  | { type: "collection.updated"; collectionId?: number }
  | { type: "dashboard.updated" };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publish(event: AppEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("[events] listener error", err);
    }
  }
}
