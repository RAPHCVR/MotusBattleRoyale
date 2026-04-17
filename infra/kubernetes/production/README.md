# Kubernetes production overlay

This overlay is intended for a cluster where:

- an ingress controller is already running in-cluster,
- `cloudflared` forwards the public hostnames to that ingress controller,
- TLS is terminated upstream, so the Kubernetes ingress only needs `ingressClassName`.

## What is included

- `web` and `game` deployments with rolling updates, probes, non-root runtime and soft topology spreading
- `postgres` and `redis` stateful workloads with persistent volumes
- separate ingress objects for the app root and the `/realtime` websocket path on the same public host
- placeholder secrets kept in version control so `kubectl apply -k` stays renderable

## Before apply

1. Replace the placeholder values in `../base/app-secrets.yaml`.
2. If your ingress controller is not NGINX, change `ingressClassName` in `ingress.patch.yaml`.
3. If you want to use different public hosts, update `runtime-config.patch.yaml` and `ingress.patch.yaml`.
4. If your GHCR packages stay private, create a pull secret:

```powershell
kubectl create secret docker-registry ghcr-pull-secret `
  --namespace motus `
  --docker-server=ghcr.io `
  --docker-username=<github-user> `
  --docker-password=<github-token-with-read:packages> `
  --docker-email=<email>
```

Then add `imagePullSecrets` to the `web` and `game` pod specs.

## Render and validate

```powershell
corepack pnpm kube:render
corepack pnpm kube:validate
```

## Apply

```powershell
kubectl apply -k infra/kubernetes/production
```

## Notes

- `postgres-init-configmap.yaml` is idempotent, but it only runs automatically when the PostgreSQL data directory is empty.
- The overlay currently points to `motus.raphcvr.me`, with `/` served by `web` and `/realtime` served by `game`.
- The overlay tracks the mutable `latest` tag for both images, and Keel polls the live cluster every minute to roll forward automatically.
