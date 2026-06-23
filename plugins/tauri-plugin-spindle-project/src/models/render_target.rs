// Render-time parameters derived from disc settings; not part of the persisted schema.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use super::{AspectMode, Disc, DiscFamily, VideoRaster, VideoStandard};

/// Render-time parameters derived from project disc settings. Not stored in the project file.
///
/// `RenderTarget` is computed once via `from_disc()` and threaded through the Skia renderer and
/// ffmpeg pipeline. It captures everything the renderer needs: raster dimensions, SAR, disc family
/// (which determines overlay strategy and minimum font size), and video standard.
///
/// Display width for DAR-corrected output = `raster_width × sar_num / sar_den`.
#[derive(Debug, Clone, Copy)]
pub struct RenderTarget {
    pub family: DiscFamily,
    /// `None` for Blu-ray (no NTSC/PAL distinction at this level).
    pub standard: Option<VideoStandard>,
    pub raster_width: u32,
    pub raster_height: u32,
    pub sar_num: u32,
    pub sar_den: u32,
}

impl RenderTarget {
    /// Derive a render target from the disc's family, video standard, and display aspect.
    pub fn from_disc(disc: &Disc, aspect: AspectMode) -> Self {
        match disc.family {
            DiscFamily::DvdVideo => {
                let (width, height) = VideoRaster::FullD1.resolution(disc.standard);
                let (dar_num, dar_den) = match aspect {
                    AspectMode::FourByThree => (4u64, 3u64),
                    AspectMode::SixteenByNine => (16u64, 9u64),
                };
                // SAR = (DAR_num * height) / (DAR_den * width), reduced by GCD.
                let mut num = dar_num * height as u64;
                let mut den = dar_den * width as u64;
                let g = gcd_u64(num, den);
                num /= g;
                den /= g;
                Self {
                    family: DiscFamily::DvdVideo,
                    standard: Some(disc.standard),
                    raster_width: width,
                    raster_height: height,
                    sar_num: num as u32,
                    sar_den: den as u32,
                }
            }
            DiscFamily::BluRay => Self {
                family: DiscFamily::BluRay,
                standard: None,
                raster_width: 1920,
                raster_height: 1080,
                sar_num: 1,
                sar_den: 1,
            },
            DiscFamily::Svcd => {
                let (width, height) = match disc.standard {
                    VideoStandard::Ntsc => (480u32, 480u32),
                    VideoStandard::Pal => (480u32, 576u32),
                };
                // SVCD SAR (4:3 only): 15:11
                Self {
                    family: DiscFamily::Svcd,
                    standard: Some(disc.standard),
                    raster_width: width,
                    raster_height: height,
                    sar_num: 15,
                    sar_den: 11,
                }
            }
            DiscFamily::Vcd => {
                let (width, height) = match disc.standard {
                    VideoStandard::Ntsc => (352u32, 240u32),
                    VideoStandard::Pal => (352u32, 288u32),
                };
                // VCD SAR (4:3 only): 10:11
                Self {
                    family: DiscFamily::Vcd,
                    standard: Some(disc.standard),
                    raster_width: width,
                    raster_height: height,
                    sar_num: 10,
                    sar_den: 11,
                }
            }
        }
    }

    /// SAR as an ffmpeg `setsar` string (e.g. `"10/11"`).
    pub fn sar_string(&self) -> String {
        format!("{}/{}", self.sar_num, self.sar_den)
    }
}

fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let tmp = b;
        b = a % b;
        a = tmp;
    }
    a.max(1)
}
