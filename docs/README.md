# Documentation

## Windows release workflow
- Create a Git tag with the desired version (for example `v0.1.0` or `v0.1.1`) and push it to GitHub, or start a GitHub Release using one of those tags.
- The `Release Windows` GitHub Actions workflow automatically installs the toolchain, runs `npm ci`, and builds the Tauri bundle.
- When the workflow finishes, download the generated Windows installer from the assets attached to the corresponding GitHub Release (bundles are published from `src-tauri/target/release/bundle/**`).

## Generating package-lock.json
- From the GitHub Actions tab, select the "Generate lockfile" workflow and click **Run workflow** to generate or refresh `package-lock.json` using `npm install --no-audit --no-fund` on a GitHub runner.
- The workflow commits `package-lock.json` back to the `main` branch using the `GITHUB_TOKEN`.
- After the lockfile has been committed by the workflow, create the next release tag (for example `v0.1.1`) to trigger the Windows release workflow and build the installer.
