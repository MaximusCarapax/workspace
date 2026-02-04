# Custom OpenClaw Sandbox with Aider

## Build

```bash
cd ~/.openclaw/workspace/docker
docker build -t openclaw-sandbox:bookworm-slim -f Dockerfile.sandbox-aider .
```

## Apply

```bash
openclaw sandbox recreate --all --force
```

## Verify

Next time the sandbox starts, aider should be available:
```bash
aider --version
```

## Notes

- This replaces the default sandbox image
- Rebuild when you want to update aider: `pipx upgrade aider-chat` won't persist
- To update: rebuild the image and `openclaw sandbox recreate --all`
