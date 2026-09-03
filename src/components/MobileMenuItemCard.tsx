type MobileMenuItemCardProps = {
    name: string
    description: string
    imageUrl?: string
    badge?: string
    price: string
    originalPrice?: string
    addLabel: string
    disabled?: boolean
    showAction?: boolean
    onAdd: () => void
}

export default function MobileMenuItemCard({
    name,
    description,
    imageUrl,
    badge,
    price,
    originalPrice,
    addLabel,
    disabled = false,
    showAction = true,
    onAdd,
}: MobileMenuItemCardProps) {
    return (
        <article className="flex min-h-36 sm:hidden overflow-hidden rounded-[22px] bg-white shadow-[0_8px_28px_rgba(61,75,55,0.1)] font-['Segoe_UI','Helvetica_Neue',Arial,sans-serif]">
            <div className='grid w-[124px] flex-none place-items-center overflow-hidden bg-[linear-gradient(140deg,#eef4e8,#d9e9cd)] text-[3.7rem]' aria-hidden='true'>
                {imageUrl ? <img className='h-full w-full object-cover' src={imageUrl} alt='' /> : '🍽️'}
            </div>
            <div className='flex min-w-0 flex-1 flex-col p-3.5'>
                {badge && <span className='self-start rounded-full bg-[#f4dfaf] px-2 py-1 text-[0.68rem] font-extrabold leading-none text-[#70521b]'>{badge}</span>}
                <p className='mt-1.5 text-[1.08rem] font-bold leading-[1.25] tracking-[-0.012em] text-[#253228] [overflow-wrap:anywhere]'>{name}</p>
                <p className='mt-[5px] overflow-hidden text-[0.83rem] text-[#718072] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]'>{description}</p>
                <div className='mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2.5'>
                    <strong className='text-[1.05rem] text-[#5b8c42]'>
                        {originalPrice && <small className='mr-1 text-inherit line-through'>{originalPrice}</small>}
                        {price}
                    </strong>
                    {showAction && <button disabled={disabled} className='flex-none rounded-xl bg-[#2e4b2d] px-[13px] py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50' onClick={onAdd}>
                        {addLabel}
                    </button>}
                </div>
            </div>
        </article>
    )
}
