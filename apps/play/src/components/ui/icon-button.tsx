import React, { forwardRef } from "react";
import type { StyleDesc } from "@gpuix/react";
import { Button, ButtonProps, ButtonVariant } from "./button";

export interface IconButtonProps extends Omit<ButtonProps, "size"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** The icon node. Rendered centered; text children are not expected. */
  children?: React.ReactNode;
  style?: StyleDesc;
}

export const IconButton = forwardRef<React.ElementRef<"div">, IconButtonProps>(
  function IconButton({ variant, size = "md", style, ...rest }, ref) {
    return (
      <Button
        {...rest}
        ref={ref}
        variant={variant}
        size="icon"
        style={style}
      />
    );
  },
);
