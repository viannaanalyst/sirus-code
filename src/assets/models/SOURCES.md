# Model brand assets

Bundled locally. `ModelBrandResolver` recognizes the upstream model family before the routing provider; exact CLI model IDs stay unchanged. Unrecognized aliases retain the host CLI mark rather than receiving an invented vendor identity.

| Brand | File | Source |
| --- | --- | --- |
| OpenAI / GPT / Codex | `openai.svg` | [OpenAI developer documentation](https://developers.openai.com), official header knot. |
| Claude / Anthropic | `../providers/claude.svg` | [Claude](https://claude.com), official orange asterisk. |
| Gemini | `gemini.svg` | Google `gstatic.com/lamda/images/gemini_sparkle_v002` asset; original sparkle. |
| Grok | `../providers/grok.svg` | [Grok favicon](https://grok.com/images/favicon.svg), glyph only. |
| DeepSeek | `deepseek.svg` | [DeepSeek](https://www.deepseek.com), whale group and clip from the official header SVG; wordmark omitted. Blue `#4D6BFE` from the [first-party DeepSeek-LLM logo](https://github.com/deepseek-ai/DeepSeek-LLM/blob/main/images/logo.svg), retained in both themes. |
| Kimi / Moonshot | `kimi.svg` | [Kimi](https://www.kimi.com), `KforKimi_f` vector from the first-party `kimi.icon-CElMvu4q.js` icon collection on `statics.moonshot.cn`; no code executed. |
| GLM / Z.ai | `zai.svg` | [First-party logo](https://z-cdn.chatglm.cn/z-ai/static/logo.svg), three white glyph shapes only; tile omitted. |
| Qwen, MiniMax, Mistral, Meta, NVIDIA, Hunyuan, LongCat, Cohere | Corresponding named SVGs | [Lobe Icons static vectors](https://github.com/lobehub/lobe-icons/tree/master/packages/static-svg/icons), MIT collection of brand marks, not first-party artwork exports. Color variants (`<brand>-color.svg`), original gradients/path geometry preserved; no theme inversion. NVIDIA uses `#76B900` from [vendor guidelines](https://www.nvidia.com/content/dam/en-zz/Solutions/about-us/NVIDIA-Brand-Guidelines-for-NVIDIA-Partner-Network-v03-3-5-19.pdf). Attribution and license in `LOBE-ICONS-LICENSE.txt`. |
| Xiaomi MiMo | `xiaomimimo.svg` | Same Lobe Icons collection; monochrome vector, no colored variant supplied. |
| Unknown | `unknown.svg` | Existing neutral placeholder. |

Vector source provenance is distinct from a vendor's identity. Community-maintained assets are not labeled as first-party exports in the registry. White monochrome marks switch to black in light mode; colored marks keep their colors. No image URLs are loaded remotely at runtime.
