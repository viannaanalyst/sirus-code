import type { LocalProfile } from "@/client/types";
import { translate, type Locale } from "@/i18n";
import { PROVIDERS } from "@/lib/provider-registry";
import { PROFILE_COLORS, profileIdentity, type ProfileStats } from "./profile-stats";

const W = 960, H = 530;
export interface ProfileCardImage { dataUrl: string; data: string; }
async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}
export async function compressProfileAvatar(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image up to 10 MiB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error("This photo is too large.");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 160;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Could not prepare the image.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
    const data = canvas.toDataURL("image/jpeg", .82);
    if (data.length > 200_000 || !data.startsWith("data:image/jpeg;base64,")) throw new Error("Could not prepare the image.");
    return data;
  } finally { URL.revokeObjectURL(url); }
}

/** One PNG feeds both the preview and native export; no DOM snapshot or remote resource. */
export async function renderProfileCard(profile: LocalProfile, defaultName: string, stats: ProfileStats, locale: Locale): Promise<ProfileCardImage> {
  await document.fonts.ready;
  const [avatar, glyph] = await Promise.all([
    profile.avatarImage ? loadImage(profile.avatarImage).catch(() => null) : null,
    loadImage("/switchyard-glyph.png").catch(() => null),
  ]);
  const identity = profileIdentity(profile, defaultName);
  const t = (key: string) => translate(locale, key);
  const number = new Intl.NumberFormat(locale);
  const canvas = document.createElement("canvas"); canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Could not prepare the image.");
  ctx.scale(2, 2); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const text = (value: string, x: number, y: number, size = 16, color = "#18212e", weight = 400, maxWidth?: number) => {
    ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color;
    let shown = value;
    if (maxWidth) { while (shown.length > 0 && ctx.measureText(`${shown}…`).width > maxWidth) shown = Array.from(shown).slice(0, -1).join(""); if (shown !== value) shown += "…"; }
    ctx.fillText(shown, x, y);
  };
  ctx.save(); ctx.beginPath(); ctx.arc(90, 82, 34, 0, 2 * Math.PI); ctx.clip();
  ctx.fillStyle = PROFILE_COLORS[profile.avatarColor]; ctx.fillRect(56, 48, 68, 68);
  if (avatar) ctx.drawImage(avatar, 56, 48, 68, 68);
  else { ctx.textAlign = "center"; text(identity.initials, 90, 91, 24, profile.avatarColor === "silver" ? "#20232a" : "#ffffff", 500); }
  ctx.restore(); ctx.textAlign = "left";
  text(identity.name, 144, 76, 24, "#18212e", 500, 470);
  text(identity.handle, 144, 101, 16, "#7c899a", 400, 470);
  if (glyph) ctx.drawImage(glyph, 740, 58, 38, 38);
  text("Switchyard", 786, 83, 18, "#526073", 500);

  const lead = stats.heatmap[0]?.weekday ?? 0;
  const columns = Math.ceil((lead + stats.heatmap.length) / 7);
  const gap = 5, cell = (848 - gap * (columns - 1)) / columns;
  const fills = ["#f5f6f8", "#d7dbe2", "#aeb5c1", "#788493", "#465465"];
  stats.heatmap.forEach((day, index) => {
    const slot = lead + index, x = 56 + Math.floor(slot / 7) * (cell + gap), y = 156 + slot % 7 * (cell + gap);
    ctx.fillStyle = fills[day.intensity]; ctx.beginPath(); ctx.roundRect(x, y, cell, cell, 4); ctx.fill();
  });
  const top = stats.topProvider;
  const topName = PROVIDERS.find(provider => provider.id === top?.provider)?.name;
  const days = (count: number) => translate(locale, count === 1 ? "{count} day" : "{count} days", { count: number.format(count) });
  const tiles = [
    [number.format(stats.totalPrompts), t("Total prompts")],
    [number.format(stats.totalSessions), t("Total sessions")],
    [days(stats.currentStreak), t("Current streak")],
    [days(stats.longestStreak), t("Longest streak")],
    [top ? `${number.format(top.percent)}%` : "—", topName ? `${topName} · ${t("Active sessions")}` : t("Most used provider")],
  ];
  tiles.forEach(([value, label], index) => { const x = 56 + index * 174; text(value, x, 388, 27); text(label, x, 415, 14, "#7c899a", 400, 160); });
  text(t("Activity from retained Switchyard sessions. Imports and inherited fork messages are excluded."), 56, 476, 13, "#7c899a", 400, 848);
  text(t("Historical token totals are unavailable."), 56, 498, 13, "#7c899a", 400, 848);
  const dataUrl = canvas.toDataURL("image/png");
  const data = dataUrl.slice("data:image/png;base64,".length);
  if (!dataUrl.startsWith("data:image/png;base64,") || data.length > 4 * 1024 * 1024 * 4 / 3) throw new Error("Activity image is too large.");
  return { dataUrl, data };
}
