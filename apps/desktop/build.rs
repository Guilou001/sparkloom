fn main() {
    // Add rpath for Swift runtime libraries (needed by screencapturekit's swift-bridge)
    // On macOS 15+, libswift_Concurrency.dylib is in the dyld shared cache under /usr/lib/swift
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    tauri_build::build()
}
