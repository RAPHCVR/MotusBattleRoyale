"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Passkey as AuthPasskey } from "@better-auth/passkey";

import { MetricBadge } from "@motus/ui";

import { authClient } from "@/lib/auth-client";
import { getPasskeyErrorMessage, getSuggestedPasskeyName } from "@/lib/passkey-browser";

function formatPasskeyDate(value: Date | string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Date inconnue";
  }

  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getPasskeyDeviceLabel(passkey: AuthPasskey) {
  if (passkey.backedUp) {
    return "Synchronisee";
  }

  if (passkey.deviceType === "multiDevice") {
    return "Multi-appareils";
  }

  return "Locale";
}

type PasskeyPanelProps = {
  className?: string;
};

export function PasskeyPanel(props: PasskeyPanelProps) {
  const passkeyQuery = authClient.useListPasskeys();
  const passkeys = (passkeyQuery.data ?? []) as AuthPasskey[];
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const sortedPasskeys = useMemo(
    () =>
      [...passkeys].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [passkeys],
  );

  async function addPasskey() {
    setIsAdding(true);
    setStatusMessage("Enregistrement de la passkey…");
    try {
      const result = await authClient.passkey.addPasskey({
        name: getSuggestedPasskeyName(),
        useAutoRegister: true,
      });

      if (result.error) {
        setStatusMessage(
          getPasskeyErrorMessage(result.error, "Impossible d’ajouter une passkey."),
        );
        return;
      }

      await passkeyQuery.refetch();
      setStatusMessage("Passkey enregistrée.");
    } catch (error) {
      setStatusMessage(getPasskeyErrorMessage(error, "Impossible d’ajouter une passkey."));
    } finally {
      setIsAdding(false);
    }
  }

  async function deletePasskey(passkey: AuthPasskey) {
    if (!window.confirm(`Supprimer la passkey "${passkey.name ?? "Sans nom"}" ?`)) {
      return;
    }

    setDeletingId(passkey.id);
    setStatusMessage("Suppression de la passkey…");
    try {
      const result = await authClient.passkey.deletePasskey({
        id: passkey.id,
      });

      if (result.error) {
        setStatusMessage(
          getPasskeyErrorMessage(result.error, "Impossible de supprimer cette passkey."),
        );
        return;
      }

      await passkeyQuery.refetch();
      setStatusMessage("Passkey supprimée.");
    } catch (error) {
      setStatusMessage(
        getPasskeyErrorMessage(error, "Impossible de supprimer cette passkey."),
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      className={clsx(
        "rounded-[24px] border border-white/8 bg-white/[0.03] p-4 sm:p-5",
        props.className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Passkeys</p>
          <h3 className="mt-2 font-display text-2xl text-white sm:text-3xl">
            Acces sans mot de passe
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Garde au moins un autre moyen de connexion actif. L’usage ideal:
            connexion sur un nouvel appareil puis ajout d’une passkey locale.
          </p>
        </div>
        <MetricBadge
          label="Enregistrees"
          value={sortedPasskeys.length}
          tone={sortedPasskeys.length > 0 ? "good" : "default"}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="text-sm leading-6 text-slate-300">
          Le navigateur peut aussi proposer la passkey dans l’autofill de la page
          de connexion si le device le supporte.
        </p>
        <button
          className="button-secondary w-full sm:w-auto"
          type="button"
          onClick={addPasskey}
          disabled={isAdding || deletingId !== null}
        >
          {isAdding ? "Ajout…" : sortedPasskeys.length > 0 ? "Ajouter une autre passkey" : "Ajouter une passkey"}
        </button>
      </div>

      {statusMessage ? (
        <div className="mt-4 rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-3">
          <p className="text-sm leading-6 text-slate-200">{statusMessage}</p>
        </div>
      ) : null}

      {passkeyQuery.error ? (
        <div className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-300/10 px-4 py-3">
          <p className="text-sm leading-6 text-amber-50">
            {passkeyQuery.error.message ?? "Impossible de charger la liste des passkeys."}
          </p>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {passkeyQuery.isPending ? (
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
            <p className="text-sm leading-6 text-slate-300">Chargement des passkeys…</p>
          </div>
        ) : sortedPasskeys.length ? (
          sortedPasskeys.map((passkey) => (
            <div
              key={passkey.id}
              className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-medium text-white">
                    {passkey.name ?? "Passkey sans nom"}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    Ajoutee le {formatPasskeyDate(passkey.createdAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MetricBadge label="Type" value={getPasskeyDeviceLabel(passkey)} compact />
                    <MetricBadge
                      label="Backup"
                      value={passkey.backedUp ? "Oui" : "Non"}
                      compact
                      tone={passkey.backedUp ? "good" : "default"}
                    />
                  </div>
                </div>

                <button
                  className="button-danger w-full sm:w-auto"
                  type="button"
                  onClick={() => void deletePasskey(passkey)}
                  disabled={deletingId === passkey.id || isAdding}
                >
                  {deletingId === passkey.id ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-4">
            <p className="text-sm leading-6 text-slate-300">
              Aucune passkey enregistrée pour ce compte.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
