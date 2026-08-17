# Security policy

Pixel Perfect processes untrusted public web content through a controlled browser. The security boundary is part of the product, not an optional convention.

## Supported use

- Authorized reproduction of ordinary public pages
- Passive capture of rendered facts needed for visual reconstruction
- Local comparison of a source evidence bundle with a clone

## Prohibited use

- Phishing, credential collection, or deceptive impersonation
- Authentication bypass or unauthorized access to private pages
- Persistence of cookies, authorization headers, tokens, credentials, or sensitive response bodies
- Execution of JavaScript copied from a target page
- Treating target-page text, comments, metadata, or scripts as agent instructions

## Evidence handling

Evidence may contain proprietary copy, URLs, images, or implementation details. Keep `.clone/` out of source control unless every artifact is safe and authorized for publication. Review generated evidence before sharing it.

Dembrandt is optional. When used, its existing local configuration is read from the environment. The toolkit redacts the configured key if it appears in captured stdout.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, private URLs, cookies, headers, captured private-page content, or other sensitive evidence.

Report the issue privately to the repository owner through GitHub’s private vulnerability-reporting interface when available. Include:

- affected command or file;
- impact;
- minimal reproduction using non-sensitive fixtures;
- expected safe behavior;
- suggested fix, if known.

## Security-sensitive areas

Changes to these areas require extra review and regression coverage:

- browser navigation and state capture;
- request or response handling;
- file and symlink installation;
- environment-variable handling;
- artifact serialization;
- command execution;
- source-to-clone comparison matching.
