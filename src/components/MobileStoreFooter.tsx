type MobileStoreFooterProps = {
    name: string
    hoursLabel: string
    hours: string
    phone: string
    address: string
    copyright: string
}

export default function MobileStoreFooter({ name, hoursLabel, hours, phone, address, copyright }: MobileStoreFooterProps) {
    return (
        <footer className="mt-3 sm:hidden border-t border-dashed border-gray-400 bg-white px-2 py-1 text-[11px] leading-4 text-[#222] font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif]">
            <div className='flex flex-wrap items-center gap-x-2'>
                <span>{name} {hoursLabel} {hours}</span>
                <span className='font-semibold text-red-500'>☎ {phone}</span>
            </div>
            <div className='flex items-center justify-between gap-3'>
                <span className='min-w-0 truncate'>{address}</span>
                <span className='shrink-0 text-right'>{copyright}</span>
            </div>
        </footer>
    )
}
