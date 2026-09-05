type MobileStoreFooterProps = {
  name: string;
  hoursLabel: string;
  hours: string;
  phone: string;
  address: string;
  copyright: string;
  mobileClassName?: string;
};

export default function MobileStoreFooter({
  name,
  hoursLabel,
  hours,
  phone,
  address,
  copyright,
  mobileClassName = "",
}: MobileStoreFooterProps) {
  return (
    <footer className={`fixed inset-x-0 bottom-0 z-10 m-0 border-t border-dashed border-gray-400 bg-white px-2 py-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] text-[11px] leading-4 text-[#222] min-[650px]:left-1/2 min-[650px]:right-auto min-[650px]:inset-x-auto min-[650px]:-translate-x-1/2 min-[650px]:whitespace-nowrap min-[650px]:rounded-t-full min-[650px]:border min-[650px]:border-b-0 min-[650px]:border-[#c5d8b7] min-[650px]:!bg-[#eaf4e5] min-[650px]:px-6 min-[650px]:py-2 min-[650px]:pb-2 min-[650px]:text-[0.82rem] min-[650px]:shadow-[0_-8px_22px_rgba(61,75,55,0.14)] ${mobileClassName}`}>
      <div className="flex flex-wrap items-center gap-x-2 min-[650px]:hidden">
        <span>
          {name} {hoursLabel} {hours}
        </span>
        <span className="font-semibold text-red-500">☎ {phone}</span>
      </div>
      <div className="flex items-center justify-between gap-3 min-[650px]:hidden">
        <span className="min-w-0 truncate">{address}</span>
        <span className="shrink-0 text-right">{copyright}</span>
      </div>
      <div className="hidden min-[650px]:flex min-[650px]:items-center min-[650px]:gap-3">
        {name && <span className="font-bold text-[#294b2d]">{name}</span>}
        <span>
          {hoursLabel}: {hours}
        </span>
        <span className="hidden font-bold text-[#b42318]">☎ {phone}</span>
        <span>{address}</span>
        <span className="text-[#526052]">{copyright}</span>
      </div>
    </footer>
  );
}
