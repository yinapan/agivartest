use napi_derive::napi;

#[napi]
pub fn ping() -> String {
    format!(
        "pong from native | platform={} | arch={} | napi",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}
