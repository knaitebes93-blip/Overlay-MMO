# Documentation

## Windows release workflow
- Create a Git tag with the desired version (for example `v0.1.0` or `v0.1.1`) and push it to GitHub, or start a GitHub Release using one of those tags.
- The `Release Windows` GitHub Actions workflow automatically installs the toolchain, runs `npm ci`, and builds the Tauri bundle.
- When the workflow finishes, download the generated Windows installer from the assets attached to the corresponding GitHub Release (bundles are published from `src-tauri/target/release/bundle/**`).
