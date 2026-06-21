use napi_derive::napi;

pub mod uia;
pub mod dpi;
pub mod recorder;

#[napi]
pub fn ping() -> String {
    format!(
        "pong from native | platform={} | arch={} | napi",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}
