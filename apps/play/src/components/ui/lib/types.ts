import type { EventPayload, StyleDesc } from "@gpuix/react";

/**
 * Event handler props shared by every component, typed against GPUIX's native
 * {@link EventPayload} (no DOM `MouseEvent`/`KeyboardEvent`).
 */
export interface UiEventProps {
  onClick?: (event: EventPayload) => void;
  onMouseDown?: (event: EventPayload) => void;
  onContextMenu?: (event: EventPayload) => void;
  onMouseUp?: (event: EventPayload) => void;
  onMouseEnter?: (event: EventPayload) => void;
  onMouseLeave?: (event: EventPayload) => void;
  onMouseMove?: (event: EventPayload) => void;
  onFocus?: (event: EventPayload) => void;
  onBlur?: (event: EventPayload) => void;
  onKeyDown?: (event: EventPayload) => void;
  onKeyUp?: (event: EventPayload) => void;
  onMouseDownOutside?: (event: EventPayload) => void;
  onChange?: (event: EventPayload) => void;
}

/** Base props every styled component accepts. */
export interface UiBaseProps extends UiEventProps {
  style?: StyleDesc;
  tabIndex?: number;
  testId?: string;
  autoFocus?: boolean;
}
