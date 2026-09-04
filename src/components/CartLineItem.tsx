type CartLineItemProps = {
  name: string;
  price: string;
  originalPrice?: string;
  details?: string;
  quantity: number;
  decreaseLabel: string;
  increaseLabel: string;
  customiseLabel: string;
  removeLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  onCustomise: () => void;
  onRemove: () => void;
};

export default function CartLineItem({
  name,
  price,
  originalPrice,
  details,
  quantity,
  decreaseLabel,
  increaseLabel,
  customiseLabel,
  removeLabel,
  onDecrease,
  onIncrease,
  onCustomise,
  onRemove,
}: CartLineItemProps) {
  return (
    <div className="flex sm:hidden items-center gap-3 border-b border-gray-100 py-[11px] font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif]">
      <div className="min-w-0 flex-1">
        <strong className="block text-[1.125rem] leading-[1.25] text-[#29382c] [overflow-wrap:anywhere]">
          {name}
        </strong>
        <small className="mt-[3px] block text-[0.85rem] font-bold text-[#5f8c25]">
          {originalPrice && (
            <del className="mr-1 font-normal text-gray-400">
              {originalPrice}
            </del>
          )}
          {price}
        </small>
        {details && (
          <small className="mt-0.5 block truncate text-[0.78rem] text-gray-500">
            {details}
          </small>
        )}
      </div>
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[1.2rem] leading-none text-[#426b38]"
            type="button"
            aria-label={decreaseLabel}
            onClick={onDecrease}
          >
            <span className="block -translate-y-px">−</span>
          </button>
          <span className="text-[1.25rem] font-bold">{quantity}</span>
          <button
            className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[1.2rem] leading-none text-[#426b38]"
            type="button"
            aria-label={increaseLabel}
            onClick={onIncrease}
          >
            <span className="block -translate-y-px">+</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#d9e6d3] bg-white p-0 text-[#426b38]"
            type="button"
            aria-label={customiseLabel}
            onClick={onCustomise}
          >
            <svg
              className="h-[14px] w-[14px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m4 16.5-.8 4.3 4.3-.8L19.1 8.4l-3.5-3.5L4 16.5Z" />
              <path d="m13.8 6.7 3.5 3.5" />
            </svg>
          </button>
          <button
            className="inline-flex h-[27px] w-[27px] items-center justify-center rounded-full border border-red-200 bg-white p-0 text-red-600"
            type="button"
            aria-label={removeLabel}
            onClick={onRemove}
          >
            <svg
              className="h-[14px] w-[14px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
