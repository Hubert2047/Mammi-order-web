import type { ReactNode } from "react";

type MenuLoadingStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
  sessionUnavailable?: boolean;
};

export default function MenuLoadingState({
  title,
  description,
  className = "",
  children,
  sessionUnavailable = false,
}: MenuLoadingStateProps) {
  return (
    <main
      className={`grid min-h-svh place-items-center bg-[#f8f6f1] p-6 ${sessionUnavailable ? "h-svh overflow-hidden overscroll-none" : ""} ${className}`}
    >
      <section
        className={`grid min-h-[360px] w-full max-w-[460px] content-center justify-items-center rounded-3xl bg-white/[0.92] px-8 py-[42px] text-center shadow-[0_16px_42px_rgba(66,78,56,0.12)] max-[520px]:min-h-[330px] max-[520px]:px-6 ${sessionUnavailable ? "text-center" : ""}`}
        aria-live="polite"
      >
        <img
          className="mb-6 aspect-square h-[220px] w-[220px] object-contain max-[520px]:h-[180px] max-[520px]:w-[180px]"
          src="/logo.png"
          alt=""
          width="96"
          height="96"
        />
        {title && (
          <h1 className="text-[clamp(1.7rem,7vw,2.35rem)] tracking-[-0.04em] text-[#253228]">
            {title}
          </h1>
        )}
        {description && (
          <p className="mt-2 max-w-[340px] text-gray-500 leading-[1.5]">
            {description}
          </p>
        )}
        {children}
      </section>
    </main>
  );
}
