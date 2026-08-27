import React, {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useState,
} from "react";

/**
 * State that can be either controlled (parent owns `value`) or uncontrolled
 * (component owns it via `defaultValue`). Mirrors the Radix/shadcn helper.
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}): [T, (value: T) => void] {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;

  const setValue = useCallback(
    (nextValue: T) => {
      if (!controlled) {
        setInternalValue(nextValue);
      }

      if (!Object.is(currentValue, nextValue)) {
        onChange?.(nextValue);
      }
    },
    [controlled, currentValue, onChange],
  );

  return [currentValue, setValue];
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref && typeof ref === "object") {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    }
  };
}

function getElementRef(element: React.ReactElement): React.Ref<unknown> | undefined {
  const props = element.props as Record<string, unknown>;

  if (props.ref) {
    return props.ref as React.Ref<unknown>;
  }

  const descriptor = Object.getOwnPropertyDescriptor(element, "ref");

  return descriptor?.value as React.Ref<unknown> | undefined;
}

function composeHandlers<A>(first: ((e: A) => void) | undefined, second?: (e: A) => void) {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return (event: A) => {
    first(event);
    second(event);
  };
}

/**
 * Render `children` as-is, or merge `props` onto a single child element when
 * `asChild` is set. Mirrors the shadcn `Slot` primitive without DOM APIs.
 */
export function renderSlot({
  asChild,
  children,
  props,
  ref,
}: {
  asChild?: boolean;
  children: React.ReactNode;
  props: Record<string, unknown>;
  ref?: React.Ref<unknown>;
}): React.ReactElement {
  if (!asChild) {
    return React.createElement("div", { ...props, ref, children } as never);
  }

  if (!isValidElement(children)) {
    throw new Error("asChild requires exactly one React element child");
  }

  const child = children as React.ReactElement<Record<string, unknown>>;
  const childProps = child.props;

  const merged: Record<string, unknown> = {
    ...childProps,
    ...props,
    style: mergeSlotStyle(childProps.style, props.style),
    onClick: composeHandlers(childProps.onClick as never, props.onClick as never),
    onMouseDown: composeHandlers(childProps.onMouseDown as never, props.onMouseDown as never),
    onMouseUp: composeHandlers(childProps.onMouseUp as never, props.onMouseUp as never),
    onMouseEnter: composeHandlers(childProps.onMouseEnter as never, props.onMouseEnter as never),
    onMouseLeave: composeHandlers(childProps.onMouseLeave as never, props.onMouseLeave as never),
    onMouseMove: composeHandlers(childProps.onMouseMove as never, props.onMouseMove as never),
    onMouseDownOutside: composeHandlers(childProps.onMouseDownOutside as never, props.onMouseDownOutside as never),
    onKeyDown: composeHandlers(childProps.onKeyDown as never, props.onKeyDown as never),
    onKeyUp: composeHandlers(childProps.onKeyUp as never, props.onKeyUp as never),
    onFocus: composeHandlers(childProps.onFocus as never, props.onFocus as never),
    onBlur: composeHandlers(childProps.onBlur as never, props.onBlur as never),
    onChange: composeHandlers(childProps.onChange as never, props.onChange as never),
  };

  if (props.tabIndex === undefined) {
    merged.tabIndex = childProps.tabIndex;
  }

  const childRef = getElementRef(child);

  if (childRef || ref) {
    merged.ref = mergeRefs(childRef, ref);
  }

  return cloneElement(child, merged as never);
}

function mergeSlotStyle(
  childStyle: unknown,
  slotStyle: unknown,
): unknown {
  if (!childStyle) {
    return slotStyle;
  }

  if (!slotStyle) {
    return childStyle;
  }

  return { ...(childStyle as object), ...(slotStyle as object) };
}

export { forwardRef };
