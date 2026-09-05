import type { ReactNode } from "react";

type OnlineCartDrawerProps = {
  children: ReactNode;
};

export default function OnlineCartDrawer({
  children,
}: OnlineCartDrawerProps) {
  return (
    <aside className="online-cart fixed inset-y-0 right-0 !z-[60] flex !w-[min(500px,94vw)] flex-col overflow-hidden rounded-l-[28px] bg-white shadow-[-16px_0_45px_rgba(25,45,29,0.2)] max-[649px]:inset-0 max-[649px]:h-svh max-[649px]:!w-screen max-[649px]:max-w-none max-[649px]:rounded-none max-[649px]:p-6 max-[649px]:shadow-none">
      {children}
    </aside>
  );
}
