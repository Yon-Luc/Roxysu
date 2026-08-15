import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { OnlineBeatmapSet } from "../../lib/api";

const GAP = 16;

function columnCountForWidth(width: number): number {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

export function DownloadSearchGrid({
  items,
  renderItem,
  hasMore,
  fetchingMore,
  onNearEnd,
}: {
  items: OnlineBeatmapSet[];
  renderItem: (set: OnlineBeatmapSet) => ReactNode;
  hasMore: boolean;
  fetchingMore: boolean;
  onNearEnd: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      setWidth(el.clientWidth);
      setScrollMargin(el.offsetTop);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, columnCountForWidth(width));
  const rowCount = Math.ceil(items.length / cols);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 320,
    overscan: 4,
    scrollMargin,
    gap: GAP,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastIndex = virtualRows[virtualRows.length - 1]?.index ?? 0;

  useEffect(() => {
    if (!hasMore || fetchingMore || rowCount === 0) return;
    if (lastIndex >= rowCount - 2) onNearEnd();
  }, [lastIndex, rowCount, hasMore, fetchingMore, onNearEnd]);

  return (
    <div ref={listRef} className="w-full">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => {
          const start = virtualRow.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap: GAP,
              }}
            >
              {rowItems.map((set) => (
                <div key={set.id}>{renderItem(set)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
