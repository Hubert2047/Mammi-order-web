import type { ReactNode } from "react";

type MenuLoadingStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export default function MenuLoadingState({
  title,
  description,
  className = "",
  children,
}: MenuLoadingStateProps) {
  return (
    <main
      className={`page online-loading-page${className ? ` ${className}` : ""}`}
    >
      <section className="card" aria-live="polite">
        <img
          className="error-logo"
          src="/logo.png"
          alt=""
          width="96"
          height="96"
        />
        {title && <h1>{title}</h1>}
        {description && <p>{description}</p>}
        {children}
      </section>
    </main>
  );
}
