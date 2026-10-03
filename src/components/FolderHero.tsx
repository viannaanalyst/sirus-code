export function FolderHero() {
  return (
    <div className="relative mx-auto h-[72px] w-[108px]" aria-hidden>
      <div className="absolute left-[18px] top-[22px] h-[38px] w-[62px] rounded-[6px] bg-background-3 shadow-[0_10px_18px_rgb(0_0_0/0.45)]" />
      <div className="absolute left-[10px] top-[16px] h-[42px] w-[70px] overflow-hidden rounded-[7px] bg-linear-to-b from-background-3 to-background-2 shadow-[0_8px_16px_rgb(0_0_0/0.4)]">
        <div className="absolute left-2 top-0 h-[8px] w-[22px] rounded-b-[3px] bg-text-muted" />
      </div>
      <div className="absolute left-[28px] top-[8px] h-[46px] w-[58px] -rotate-[18deg] rounded-[6px] bg-linear-to-br from-text-primary to-text-secondary shadow-[0_6px_14px_rgb(0_0_0/0.35)]" />
    </div>
  );
}
