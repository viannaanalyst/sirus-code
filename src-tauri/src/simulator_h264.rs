//! Low-latency H.264 parameters for the Simulator pane (ADR-066).
//!
//! VideoToolbox's SPS carries no VUI `bitstream_restriction`, so a decoder must
//! assume frames may be reordered and holds pictures back until its buffer
//! fills or it is flushed. WebKit's WebCodecs decoder then shows nothing while
//! the screen animates. Rewriting the SPS to declare `max_num_reorder_frames = 0`
//! (and `max_dec_frame_buffering = max_num_ref_frames`) lets every decoded frame
//! out immediately. The stream has no B-frames, so the declaration is true.

/// Rewrites every SPS NAL unit in an Annex-B parameter payload; other units are
/// copied. Returns `None` when an SPS cannot be parsed (the caller keeps the original).
pub fn low_latency_parameters(payload: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(payload.len() + 16);
    for unit in annexb_units(payload) {
        out.extend_from_slice(&[0, 0, 0, 1]);
        if unit.first().map(|header| header & 0x1f) == Some(7) {
            out.extend_from_slice(&rewrite_sps(unit)?);
        } else {
            out.extend_from_slice(unit);
        }
    }
    Some(out)
}

/// NAL units between Annex-B start codes (`00 00 01` or `00 00 00 01`).
fn annexb_units(data: &[u8]) -> Vec<&[u8]> {
    let mut starts = vec![];
    let mut index = 0;
    while index + 3 <= data.len() {
        if data[index] == 0 && data[index + 1] == 0 && data[index + 2] == 1 {
            starts.push(index + 3);
            index += 3;
        } else {
            index += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(position, start)| {
            let mut end = starts
                .get(position + 1)
                .map(|next| next - 3)
                .unwrap_or(data.len());
            // A four-byte start code leaves one zero byte before the next unit.
            while end > *start && data[end - 1] == 0 && starts.get(position + 1).is_some() {
                end -= 1;
            }
            &data[*start..end]
        })
        .filter(|unit| !unit.is_empty())
        .collect()
}

fn unescape(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut zeros = 0;
    for &byte in data {
        if zeros >= 2 && byte == 3 {
            zeros = 0;
            continue;
        }
        zeros = if byte == 0 { zeros + 1 } else { 0 };
        out.push(byte);
    }
    out
}

fn escape(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 4);
    let mut zeros = 0;
    for &byte in data {
        if zeros >= 2 && byte <= 3 {
            out.push(3);
            zeros = 0;
        }
        zeros = if byte == 0 { zeros + 1 } else { 0 };
        out.push(byte);
    }
    out
}

struct Reader<'a> {
    data: &'a [u8],
    bit: usize,
}

impl Reader<'_> {
    fn u(&mut self, count: u32) -> Option<u32> {
        let mut value = 0u32;
        for _ in 0..count {
            let byte = *self.data.get(self.bit / 8)?;
            value = (value << 1) | u32::from((byte >> (7 - self.bit % 8)) & 1);
            self.bit += 1;
        }
        Some(value)
    }

    fn ue(&mut self) -> Option<u32> {
        let mut zeros = 0;
        while self.u(1)? == 0 {
            zeros += 1;
            if zeros > 31 {
                return None;
            }
        }
        Some((1u32 << zeros) - 1 + self.u(zeros)?)
    }

    fn se(&mut self) -> Option<i32> {
        let code = self.ue()?;
        Some(if code % 2 == 1 {
            code.div_ceil(2) as i32
        } else {
            -((code / 2) as i32)
        })
    }
}

#[derive(Default)]
struct Writer {
    data: Vec<u8>,
    bit: usize,
}

impl Writer {
    fn u(&mut self, count: u32, value: u32) {
        for index in (0..count).rev() {
            if self.bit.is_multiple_of(8) {
                self.data.push(0);
            }
            if (value >> index) & 1 == 1 {
                let last = self.data.len() - 1;
                self.data[last] |= 1 << (7 - self.bit % 8);
            }
            self.bit += 1;
        }
    }

    fn ue(&mut self, value: u32) {
        let code = value + 1;
        let length = 32 - code.leading_zeros();
        self.u(length - 1, 0);
        self.u(length, code);
    }

    /// Copies the bits `from..to` of `data` verbatim.
    fn copy(&mut self, data: &[u8], from: usize, to: usize) {
        for bit in from..to {
            self.u(1, u32::from((data[bit / 8] >> (7 - bit % 8)) & 1));
        }
    }
}

fn skip_scaling_list(reader: &mut Reader, size: u32) -> Option<()> {
    let (mut last, mut next) = (8i32, 8i32);
    for _ in 0..size {
        if next != 0 {
            next = (last + reader.se()? + 256) % 256;
        }
        if next != 0 {
            last = next;
        }
    }
    Some(())
}

fn skip_hrd(reader: &mut Reader) -> Option<()> {
    let count = reader.ue()? + 1;
    if count > 32 {
        return None;
    }
    reader.u(8)?;
    for _ in 0..count {
        reader.ue()?;
        reader.ue()?;
        reader.u(1)?;
    }
    reader.u(20)?;
    Some(())
}

/// Returns the SPS NAL (header included) with low-latency bitstream restrictions.
fn rewrite_sps(nal: &[u8]) -> Option<Vec<u8>> {
    let rbsp = unescape(nal.get(1..)?);
    let mut reader = Reader {
        data: &rbsp,
        bit: 0,
    };
    let profile = reader.u(8)?;
    reader.u(16)?; // constraint flags, level
    reader.ue()?; // seq_parameter_set_id
    if matches!(
        profile,
        100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128 | 138 | 139 | 134 | 135
    ) {
        let chroma = reader.ue()?;
        if chroma == 3 {
            reader.u(1)?;
        }
        reader.ue()?;
        reader.ue()?;
        reader.u(1)?;
        if reader.u(1)? == 1 {
            for list in 0..if chroma == 3 { 12 } else { 8 } {
                if reader.u(1)? == 1 {
                    skip_scaling_list(&mut reader, if list < 6 { 16 } else { 64 })?;
                }
            }
        }
    }
    reader.ue()?; // log2_max_frame_num_minus4
    match reader.ue()? {
        0 => {
            reader.ue()?;
        }
        1 => {
            reader.u(1)?;
            reader.se()?;
            reader.se()?;
            for _ in 0..reader.ue()?.min(256) {
                reader.se()?;
            }
        }
        _ => {}
    }
    let reference_frames = reader.ue()?;
    reader.u(1)?; // gaps_in_frame_num_value_allowed_flag
    reader.ue()?;
    reader.ue()?;
    if reader.u(1)? == 0 {
        reader.u(1)?; // mb_adaptive_frame_field_flag
    }
    reader.u(1)?; // direct_8x8_inference_flag
    if reader.u(1)? == 1 {
        for _ in 0..4 {
            reader.ue()?;
        }
    }
    let vui_flag = reader.bit;
    let mut writer = Writer::default();
    writer.copy(&rbsp, 0, vui_flag);
    writer.u(1, 1); // vui_parameters_present_flag
    if reader.u(1)? == 1 {
        // Keep the existing VUI up to its bitstream restriction, which is replaced.
        let vui_start = reader.bit;
        if reader.u(1)? == 1 && reader.u(8)? == 255 {
            reader.u(32)?;
        }
        if reader.u(1)? == 1 {
            reader.u(1)?;
        }
        if reader.u(1)? == 1 {
            reader.u(4)?;
            if reader.u(1)? == 1 {
                reader.u(24)?;
            }
        }
        if reader.u(1)? == 1 {
            reader.ue()?;
            reader.ue()?;
        }
        if reader.u(1)? == 1 {
            reader.u(32)?;
            reader.u(32)?;
            reader.u(1)?;
        }
        let nal_hrd = reader.u(1)? == 1;
        if nal_hrd {
            skip_hrd(&mut reader)?;
        }
        let vcl_hrd = reader.u(1)? == 1;
        if vcl_hrd {
            skip_hrd(&mut reader)?;
        }
        if nal_hrd || vcl_hrd {
            reader.u(1)?;
        }
        reader.u(1)?; // pic_struct_present_flag
        writer.copy(&rbsp, vui_start, reader.bit);
    } else {
        // aspect ratio, overscan, video signal, chroma location, timing, NAL/VCL HRD
        // and pic_struct are all absent.
        writer.u(8, 0);
    }
    writer.u(1, 1); // bitstream_restriction_flag
    writer.u(1, 1); // motion_vectors_over_pic_boundaries_flag
    writer.ue(2); // max_bytes_per_pic_denom (default)
    writer.ue(1); // max_bits_per_mb_denom (default)
    writer.ue(16); // log2_max_mv_length_horizontal (default)
    writer.ue(16); // log2_max_mv_length_vertical (default)
    writer.ue(0); // max_num_reorder_frames
    writer.ue(reference_frames.max(1)); // max_dec_frame_buffering
    writer.u(1, 1); // rbsp_stop_one_bit
    while !writer.bit.is_multiple_of(8) {
        writer.u(1, 0);
    }
    let mut out = vec![nal[0]];
    out.extend(escape(&writer.data));
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SPS + PPS emitted by the helper for an iPhone 18 Pro (1206×2622, Baseline).
    const CAPTURED: &str = "0000000127420033ab402600a4f3520000000128ce3c80";

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&text[index..index + 2], 16).unwrap())
            .collect()
    }

    /// Reads back the fields the rewrite must preserve or set.
    fn summary(sps: &[u8]) -> (u32, u32, u32, u32, u32) {
        let rbsp = unescape(&sps[1..]);
        let mut reader = Reader {
            data: &rbsp,
            bit: 0,
        };
        let profile = reader.u(8).unwrap();
        reader.u(16).unwrap();
        reader.ue().unwrap();
        reader.ue().unwrap();
        if reader.ue().unwrap() == 0 {
            reader.ue().unwrap();
        }
        let references = reader.ue().unwrap();
        reader.u(1).unwrap();
        let width = (reader.ue().unwrap() + 1) * 16;
        let height = (reader.ue().unwrap() + 1) * 16;
        if reader.u(1).unwrap() == 0 {
            reader.u(1).unwrap();
        }
        reader.u(1).unwrap();
        if reader.u(1).unwrap() == 1 {
            for _ in 0..4 {
                reader.ue().unwrap();
            }
        }
        assert_eq!(reader.u(1).unwrap(), 1, "VUI present");
        assert_eq!(reader.u(8).unwrap(), 0, "no other VUI fields");
        assert_eq!(reader.u(1).unwrap(), 1, "bitstream restriction");
        reader.u(1).unwrap();
        for _ in 0..4 {
            reader.ue().unwrap();
        }
        let reorder = reader.ue().unwrap();
        let buffering = reader.ue().unwrap();
        assert_eq!(buffering, references.max(1));
        (profile, width, height, reorder, references)
    }

    #[test]
    fn captured_sps_gains_zero_reordering_and_keeps_its_geometry() {
        let original = hex(CAPTURED);
        let rewritten = low_latency_parameters(&original).unwrap();
        let units = annexb_units(&rewritten);
        assert_eq!(units.len(), 2);
        assert_eq!(units[0][0] & 0x1f, 7);
        assert_eq!(units[1], &hex("28ce3c80")[..], "PPS is untouched");
        let (profile, width, height, reorder, _) = summary(units[0]);
        assert_eq!(profile, 66);
        assert_eq!((width, height), (1216, 2624)); // macroblocks; cropping trims to 1206×2622
        assert_eq!(reorder, 0);
        // Rewriting again is stable.
        assert_eq!(low_latency_parameters(&rewritten).unwrap(), rewritten);
    }

    #[test]
    fn emulation_prevention_round_trips() {
        let raw = [0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x07];
        assert_eq!(unescape(&escape(&raw)), raw);
        assert!(!escape(&raw).windows(3).any(|w| w == [0, 0, 1]));
    }

    #[test]
    fn garbage_is_refused_without_panicking() {
        assert!(low_latency_parameters(&[0, 0, 0, 1, 0x67]).is_none());
        assert!(low_latency_parameters(&[0, 0, 0, 1, 0x67, 0xff, 0xff]).is_none());
        assert_eq!(low_latency_parameters(&[]).unwrap(), Vec::<u8>::new());
    }
}
