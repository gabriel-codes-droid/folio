# N. Mandrake Gabriel — Portfolio

A dynamic **3D portfolio website** built to showcase creative work, current and past projects, and the developer behind the code. 

[![Astro Version](https://shields.io)](https://astro.build)
[![License: MIT](https://shields.io)](https://opensource.org)
[![Maintenance](https://shields.io)](https://github.com/)

---

## ✨ Features

- **3D Interactive Elements:** Immersive visual experience to instantly capture user attention.
- **Project Showcase:** Highlights current experiments and deep-dive historic case studies.
- **About the Developer:** Dedicated space sharing background, technical skills, and experience.
- **Blazing Fast Performance:** Built on top of Astro's zero-JS-by-default architecture for optimal SEO and speed.

---

## 🛠️ Tech Stack

- **Framework:** [Astro](https://astro.build/) (Static Site Generation & Performance)
- **3D Graphics:** Three.js / React Three Fiber (or your specific 3D library)
- **Styling:** Tailwind CSS (or your choice of styling)

---

## 🚀 Getting Started

Follow these quick steps to get a local copy of the project up and running.

### Prerequisites

Make sure you have Node.js installed on your machine:
* **Node.js 24** and **npm**
* **Git LFS** to download the 3D models

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/gabriel-codes-droid/folio.git
   ```

2. **Navigate into the project directory:**
   ```bash
   cd folio
   ```

3. **Install dependencies:**
   ```bash
   git lfs pull
   npm ci
   ```

### Running Locally

To fire up the local development server and view your 3D portfolio live:

```bash
npm run dev -- --background
```
Open **http://localhost:4321** in your browser to see the result!

---

## Contact form

The large email address and arrow open the in-page compose panel. Contact cards are selected by clicking, and their action links open their destinations; the Email card uses `mailto:` to open the visitor's email app. The composer keeps a single send action without a duplicate mail-app link.

Copy `.env.example` to `.env`, add a Resend API key, and set `RESEND_FROM_EMAIL` to a verified sender. Never commit the key. Secrets are read only on the server at runtime, not embedded in either build bundle. Local development loads `.env`; on Vercel, set both values in Project Settings → Environment Variables. Pushing code does not configure those secrets on the host. Resend's default `onboarding@resend.dev` sender is for testing to the Resend account owner's email; use a verified domain for production.

## Deploy to Vercel

1. Import `gabriel-codes-droid/folio` in Vercel and use `main` with the repository root as the root directory.
2. Use the Astro framework preset and Node.js 24. `vercel.json` sets `npm ci` as the install command and `npm run build` as the build command. Leave the output directory at the framework default.
3. Enable **Project Settings → Git → Git Large File Storage (LFS)**. If the initial import has already built without LFS, enable it and redeploy. The prebuild check intentionally fails when models are still pointers.
4. Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for Production and, if needed, Preview. Redeploy after changing them. Local `.env` files are excluded from Git and deployment.
5. Deploy and check the space journey, project panels, mobile layout, and contact form on the generated URL. Future pushes to `main` deploy automatically once the repository is connected.

The Vercel adapter builds `.vercel/output/`. The homepage is prerendered and served as static HTML; React and Three.js still run the complete space journey in the browser. `/api/contact` runs as a Vercel Function. Vercel does not need a standalone Node server or `npm start` command.

The models remain in `public/models/` and are served as static files, outside the contact function. Vercel's documented 100 MB Hobby source-upload limit applies to CLI uploads; use GitHub import for this repository. The assets are still large, so test loading on a real connection and monitor bandwidth usage. The old `dist-verify/` build snapshot is excluded from Git and deployment; its local copy can be retained.

References: [Astro Vercel adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/), [Vercel Git LFS setting](https://vercel.com/docs/project-configuration/git-settings#git-large-file-storage-lfs), [Vercel limits](https://vercel.com/docs/limits#static-file-uploads).

## Verification

### Scene downloads

The space journey streams two assets at a time, using one request per file on a healthy connection. Interrupted requests resume from their last received byte instead of downloading the file again. The 45-second timeout only fires when no data arrives, not while a slow download is making progress. The retry button retains downloaded bytes instead of reloading the page. Models are parsed only after their binary downloads finish, followed by the existing texture/shader GPU warm-up.

Complete assets are stored in an optional, versioned browser cache for repeat visits. Length, GLB headers and (where Web Crypto is available) manifest hashes are checked before reuse. Cache failures or unavailable storage fall back to downloads; background cache writes never gate scene readiness. Superseded versions are removed only from this application's asset cache.

`prebuild` generates the size/version manifest from `public/models/`. Run the build again whenever a model changes. Model textures use WebP with bounded dimensions to reduce decoded/GPU memory (1K for the multi-material mech and distant debris, 2K for cubes/planets, 4K for the single-texture shuttle and moon). Geometry, rigs and animations are unchanged. The original sky-lighting source is archived in `assets/source/night-sky.exr` (excluded from deployment); the scene uses a smaller HDR derived from that source. Its visible star background is separate and unchanged.

Lossless Meshopt geometry compression reduces the complete scene download from 158.5 MB to 103.1 MB without changing scene layout, geometry, rigs, animations or texture bytes. `scripts/optimize-glb-geometry.mjs` writes to a separate output file and verifies every compressed buffer with the installed scene loader's decoder. `tests/geometryCompression.test.mjs` checks decoded-content fingerprints against the previous assets and constructs every model with the installed GLTFLoader. Update those fingerprints only for intentional artwork changes. These headless checks do not replace browser texture/GPU testing. First visits still transfer a substantial amount of data; connection speed and device performance affect readiness.

### Checks

```sh
npm test
npm run build
```

The build checks scene references and validates GLB headers and lengths so incomplete Git LFS downloads cannot deploy silently. A postbuild check verifies that public assets were copied intact and that the server function stays within its size limit without including models or private environment files. Tests also cover the contact endpoint, loading screen, continuous journey path, and dotted-grid interaction. Use `npm run dev` for local interaction and a Vercel Preview deployment for platform-specific checks.

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
