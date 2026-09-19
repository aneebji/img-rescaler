# Security policy

Image Rescaler processes selected images locally in the browser or Electron desktop app. Security concerns can still arise from image decoding, dependency vulnerabilities, unsafe filename handling, or the Electron boundary.

## Supported code

Security fixes are maintained on the latest `main` branch. Older source snapshots and locally built desktop packages may require rebuilding to receive fixes. The repository does not offer a long-term support schedule.

## Report a vulnerability

If GitHub private vulnerability reporting is available for this repository, use **Security → Report a vulnerability**:

[Open a private vulnerability report](https://github.com/aneebji/img-rescaler/security/advisories/new)

If that option is unavailable, open a public issue titled **Request for private security contact** with no vulnerability details, personal data, or attachments, and ask the maintainer for a private reporting channel.

Include the following only in the private report:

- A description of the issue and its potential impact.
- The affected commit or version and whether it concerns the browser or desktop app.
- Operating system, browser, or Electron environment details.
- Minimal reproduction steps and a safe proof of concept, if available.
- Any proposed mitigation or fix.

Please allow time for investigation and a fix before sharing technical details publicly. There is no guaranteed response time or paid bug bounty program stated by this project.

## Safe investigation

Use your own local checkout, test images, and accounts. Avoid testing against other people's files or systems. Do not include sensitive images or metadata in reports, and do not upload a malicious attachment to a public issue.

## Scope

Relevant reports include unintended file access, data disclosure, script execution through app inputs, unsafe Electron IPC behavior, and exploitable vulnerabilities in dependencies used by the application. Routine feature requests and visual bugs belong in the regular issue tracker.
