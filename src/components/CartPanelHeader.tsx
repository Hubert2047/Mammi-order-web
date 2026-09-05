type CartPanelHeaderProps = {
  cartLabel: string;
  count: number;
  itemLabel: string;
  total: string;
  originalTotal?: string;
  isQuoteLoading?: boolean;
  unavailableMessage?: string;
  closeLabel: string;
  onClose: () => void;
  className?: string;
};

export default function CartPanelHeader({
  cartLabel,
  count,
  itemLabel,
  total,
  originalTotal,
  isQuoteLoading = false,
  unavailableMessage,
  closeLabel,
  onClose,
  className = "",
}: CartPanelHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-gray-100 px-6 pb-[10px] pt-5 font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] text-[1.05rem] text-[#24312a] ${className}`}
    >
      <div className="grid min-w-0 gap-[3px]">
        <strong className="text-[1.1rem] leading-[1.3] [overflow-wrap:anywhere]">
          {cartLabel} · {count} {itemLabel}
        </strong>
        <small className="flex items-baseline gap-2 text-[1.2rem] font-extrabold leading-[1.3] text-[#8ac545]">
          {unavailableMessage ? (
            <span className="text-[0.83rem] font-bold leading-snug text-red-600">
              {unavailableMessage}
            </span>
          ) : isQuoteLoading ? (
            <span className="inline-block min-w-20 animate-pulse text-gray-300">
              …
            </span>
          ) : (
            <>
              {originalTotal && (
                <del className="text-[0.95rem] font-normal text-gray-400">
                  {originalTotal}
                </del>
              )}
              <span>{total}</span>
            </>
          )}
        </small>
      </div>
      <button
        className="relative -top-[10px] -right-[2px] grid h-[38px] w-[38px] flex-none place-items-center rounded-full border-0 bg-[#eef3ea] p-0 text-[1.55rem] leading-[0.8] text-[#526052]"
        onClick={onClose}
        aria-label={closeLabel}
      >
        <span className="block translate-x-px -translate-y-[3px] text-[1.6rem]">
          ×
        </span>
      </button>
    </div>
  );
}
