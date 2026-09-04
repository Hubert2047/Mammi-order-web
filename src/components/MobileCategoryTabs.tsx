type CategoryTab = { id: string; label: string };

type MobileCategoryTabsProps = {
  tabs: CategoryTab[];
  selectedId: string;
  ariaLabel: string;
  className?: string;
  onSelect: (id: string) => void;
};

export default function MobileCategoryTabs({
  tabs,
  selectedId,
  ariaLabel,
  className = "",
  onSelect,
}: MobileCategoryTabsProps) {
  return (
    <nav
      className={`mb-3 flex w-full flex-wrap gap-x-5 gap-y-1 border-b border-[#edf0e9] bg-white px-0 pb-2 pt-[18px] font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif] sm:hidden ${className}`}
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const active = tab.id === selectedId;
        return (
          <button
            className={`relative border-0 bg-transparent px-0 py-2 text-[0.95rem] font-bold transition-colors ${active ? "text-[#315b34] after:absolute after:inset-x-0 after:bottom-[3px] after:h-0.5 after:bg-[#315b34] after:content-['']" : "text-[#6b7280]"}`}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
