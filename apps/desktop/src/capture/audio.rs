/// Audio capture configuration defaults.
/// System audio is captured via SCStream (same stream as video).
/// Microphone is captured via SCStream on macOS 15+ (with_captures_microphone).

pub const SAMPLE_RATE: i32 = 48_000;
pub const CHANNEL_COUNT: i32 = 2;
