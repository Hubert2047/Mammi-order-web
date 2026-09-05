type MobileMenuItemCardProps = {
  name: string;
  description: string;
  imageUrl?: string;
  fallbackIcon?: string;
  badge?: string;
  price: string;
  originalPrice?: string;
  addLabel: string;
  disabled?: boolean;
  unavailable?: boolean;
  showAction?: boolean;
  onAdd: () => void;
};

export default function MobileMenuItemCard({
  name,
  description,
  imageUrl,
  fallbackIcon = "🍽️",
  badge,
  price,
  originalPrice,
  addLabel,
  disabled = false,
  unavailable = false,
  showAction = true,
  onAdd,
}: MobileMenuItemCardProps) {
  return (
    <article className="flex min-h-36 overflow-hidden rounded-[22px] border border-[#edf0e9] bg-white font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] sm:hidden">
      <div
        className="grid w-[124px] flex-none place-items-center overflow-hidden bg-[linear-gradient(140deg,#eef4e8,#d9e9cd)] text-[3.7rem]"
        aria-hidden="true"
      >
        {imageUrl ? (
          <img className="h-full w-full object-cover" src={imageUrl} alt="" />
        ) : fallbackIcon === "dessert" ? (
          <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 39h32c-1 8-7 13-16 13s-15-5-16-13Z" fill="#f8fff1" strokeWidth="2.5" />
            <path d="M22 24h20v12c0 4-4 6-10 6s-10-2-10-6V24Z" fill="#e7a9bd" strokeWidth="2.5" />
            <ellipse cx="32" cy="24" rx="10" ry="3.5" fill="#f6bfd1" strokeWidth="2" />
            <path d="M27 28v8M32 27v10M37 28v8" stroke="#fff1f5" strokeWidth="1.4" />
            <path d="M49 12c3 0 4 2 4 4 0 3-2 5-4 5v26" strokeWidth="2" />
          </svg>
        ) : fallbackIcon === "side" ? (
          <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="32" cy="34" r="18" fill="#f8fff1" strokeWidth="2.5" />
            <circle cx="32" cy="34" r="12" fill="#fffdf3" strokeWidth="1.8" />
            <path d="M14 13v14M11 13v7M17 13v7M14 20v7M50 13v14M47 13v14M53 13v14M50 27v24" strokeWidth="2" />
          </svg>
        ) : fallbackIcon === "bun" ? (
          <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 31h42c-1 14-9 22-21 22S12 45 11 31Z" fill="#f8fff1" strokeWidth="2.5" />
            <ellipse cx="32" cy="31" rx="21" ry="8" fill="#fffdf3" strokeWidth="2.5" />
            <path d="M18 30c4-5 7 5 11 0s7 5 11 0 5 3 7 0" strokeWidth="2" />
            <path d="M24 27c2-3 4-3 6 0M34 27c2-3 4-3 6 0" strokeWidth="1.5" />
            <path d="m20 34 7-3M22 37l7-3M37 34l7-3M39 37l6-3" stroke="#c87555" strokeWidth="2.5" />
            <circle cx="28" cy="34" r="2.5" fill="#9fcf78" strokeWidth="1.2" />
            <circle cx="34" cy="36" r="2.5" fill="#b4d987" strokeWidth="1.2" />
          </svg>
        ) : fallbackIcon === "rice" ? (
          <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <ellipse cx="32" cy="42" rx="22" ry="8" fill="#f8fff1" strokeWidth="2.5" />
            <path d="M18 38c2-9 8-14 14-14s12 5 14 14" fill="#fffdf3" strokeWidth="2.5" />
            <path d="M22 31c4-3 12-3 18 0M24 28c3-3 5-3 8-1M28 25c2-2 5-2 7 0" strokeWidth="1.8" />
            <path d="M24 33c1-1 2-1 3 0M29 30c1-1 2-1 3 0M35 32c1-1 2-1 3 0M31 35c1-1 2-1 3 0" strokeWidth="1.2" />
            <path d="M36 35c2-4 8-4 10 0l-2 5H35l1-5Z" fill="#c87555" strokeWidth="2" />
            <circle cx="20" cy="37" r="3" fill="#9fcf78" strokeWidth="1.5" />
            <circle cx="25" cy="35" r="2.5" fill="#b4d987" strokeWidth="1.5" />
          </svg>
        ) : fallbackIcon === "pho" ? (
          <svg className="h-16 w-16 text-[#7b9b68]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M39 12 53 25M43 11l10 10" strokeWidth="3" />
            <path d="M12 30h40c-1 13-9 22-20 22S13 43 12 30Z" fill="#f8fff1" strokeWidth="2.5" />
            <path d="M17 35c5 4 25 4 30 0M20 41c6 3 18 3 24 0" strokeWidth="2" />
            <path d="M25 26c-2-4 3-5 1-9M34 26c-2-4 3-5 1-9" strokeWidth="2" />
          </svg>
        ) : (
          fallbackIcon
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        {badge && (
          <span
            className={`self-start rounded-full bg-[#f4dfaf] px-2 py-1 text-[0.68rem] font-extrabold leading-none ${unavailable ? "text-[#dc2626]" : "text-[#70521b]"}`}
          >
            {badge}
          </span>
        )}
        <p className="mt-1.5 text-[1.08rem] font-bold leading-[1.25] tracking-[-0.012em] text-[#253228] [overflow-wrap:anywhere]">
          {name}
        </p>
        <p className="mt-[5px] overflow-hidden text-[0.83rem] text-[#718072] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {description}
        </p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2.5">
          <strong className="text-[1.05rem] text-[#5b8c42]">
            {originalPrice && (
              <small className="mr-1 text-inherit line-through">
                {originalPrice}
              </small>
            )}
            {price}
          </strong>
          {showAction && !unavailable && (
            <button
              disabled={disabled}
              className="flex-none rounded-xl bg-[#2e4b2d] px-[13px] py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onAdd}
            >
              <span
                className={
                  unavailable ? "font-extrabold text-[#b91c1c]" : undefined
                }
              >
                {addLabel}
              </span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
