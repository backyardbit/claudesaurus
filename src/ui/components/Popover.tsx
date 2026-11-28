import { type ReactNode, useEffect, useRef } from "react";

type PopoverProps = {
  open: boolean;
  onClose(): void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
};

export function Popover({ open, onClose, trigger, children, align = "left" }: PopoverProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && container.current?.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  return (
    <div className="popover-anchor" ref={container}>
      {trigger}
      {open && <div className={`popover ${align}`}>{children}</div>}
    </div>
  );
}
