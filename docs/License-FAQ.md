# License FAQ

### Can you summarize what Companion Mentra's license allows?

The license grants free rights to use, modify, and redistribute Companion Mentra source code for personal or nonprofit purposes. The intent is to stay permissive for those uses while limiting commercial abuse of Companion Intelligence products.

Companion Mentra is the server side of Companion for Mentra. It exposes an OpenAI-compatible API surface (`/v1/*`) so the rest of the Companion Intelligence platform can talk to it like any other model provider. The glasses are used through the phone app in `mobile/`.

Companion Mentra uses the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). The full text is in [`LICENSE.md`](../LICENSE.md).

### What freedoms do you have as a Companion Mentra user?

If you use Companion Mentra for personal or nonprofit purposes, you can view, modify, and redistribute the source under the same license terms, subject to the PolyForm Noncommercial restrictions.

### Can I fork Companion Mentra?

Yes. For noncommercial use, you can fork, modify, and redistribute Companion Mentra under the same license.

### Can I contribute to Companion Mentra?

Yes. Open a pull request on this repository.

### Can I sell Companion Mentra?

No. Selling Companion Mentra, including cloud-hosted instances, appliances that ship it, or paid support for those products, is not permitted. For commercial partnership questions, email partner@companionintelligence.com.

### Are any files in this repository under a different license?

Yes. Fifteen files in `mobile/` are adapted from the Mentra Bluetooth SDK Starter Kit, Copyright 2026 Mentra Labs, Inc., and stay under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The license text is in [`mobile/LICENSE-Apache-2.0`](../mobile/LICENSE-Apache-2.0), and [`mobile/README.md`](../mobile/README.md#attribution) lists the files. Everything else in this repository is under the PolyForm Noncommercial License 1.0.0.

### Does this license apply to the rest of Companion Intelligence?

Companion Portal stays a separate commercial product — this license does not apply to it.

Companion Hub, Companion Memory, Companion Marketplace, Companion OS, Companion Capture, Companion Browser Extension, Companion OMI, Companion Even Realities, Companion Pebble, and Companion Home Assistant Voice PE use the same PolyForm Noncommercial terms in their own repositories.

Companion Pipe and Companion MaixCAM are still under legal review for third-party licensing terms in code they bundle — don't assume they're covered by this FAQ until that review lands.

### Unsure whether your use case is allowed?

Email support@companionintelligence.com.
