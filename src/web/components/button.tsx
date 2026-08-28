import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/utils";

const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button--default",
      quiet: "button--quiet",
      danger: "button--danger",
    },
    size: {
      default: "button--default-size",
      small: "button--small",
      icon: "button--icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
