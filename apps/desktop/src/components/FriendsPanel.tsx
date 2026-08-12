import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Friendship, Profile } from "@molezinha/shared";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Avatar } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { IconFriends, IconPlus } from "./Icons";
import { PromptModal } from "./PromptModal";

type PendingRow = Friendship & {
  requester: Pick<Profile, "id" | "username" | "display_name" | "avatar_url" | "status"> | null;
};

type FriendRow = {
  friendship_id: string;
  user: Profile;
};

type PersonSummary = Pick<
  Profile,
  "id" | "username" | "display_name" | "avatar_url" | "status"
> | null;

/** One person + their actions, shared by the pending and accepted lists. */
function PersonRow({ person, children }: { person: PersonSummary; children: ReactNode }) {
  return (
    <div className="user-panel person-row">
      <Avatar
        size="sm"
        name={person?.display_name ?? "?"}
        url={person?.avatar_url}
        id={person?.id}
        status={person?.status}
      />
      <div className="user-panel-identity">
        <span className="user-panel-name">{person?.display_name ?? "Alguém"}</span>
        <span className="user-panel-handle muted">@{person?.username}</span>
      </div>
      {children}
    </div>
  );
}

interface Props {
  friendsTick?: number;
  onOpenDm: (user: Profile) => void;
  onChanged?: () => void;
}

export function FriendsPanel({ friendsTick = 0, onOpenDm, onChanged }: Props) {
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;

    const { data: rows, error } = await supabase
      .from("friendships")
      .select("*")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (error) {
      setStatus(error.message);
      return;
    }

    const list = (rows ?? []) as Friendship[];
    const accepted = list.filter((f) => f.status === "accepted");
    const incoming = list.filter(
      (f) => f.status === "pending" && f.addressee_id === user.id
    );

    const otherIds = [
      ...new Set([
        ...accepted.map((f) =>
          f.requester_id === user.id ? f.addressee_id : f.requester_id
        ),
        ...incoming.map((f) => f.requester_id),
      ]),
    ];

    let profilesById = new Map<string, Profile>();
    if (otherIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, status, custom_status, banner_color, accent_color")
        .in("id", otherIds);
      profilesById = new Map(
        ((profiles ?? []) as Profile[]).map((p) => [p.id, p])
      );
    }

    setFriends(
      accepted.map((f) => {
        const otherId =
          f.requester_id === user.id ? f.addressee_id : f.requester_id;
        return {
          friendship_id: f.id,
          user: profilesById.get(otherId)!,
        };
      }).filter((f) => f.user)
    );

    setPending(
      incoming.map((f) => ({
        ...f,
        requester: profilesById.get(f.requester_id)
          ? {
              id: profilesById.get(f.requester_id)!.id,
              username: profilesById.get(f.requester_id)!.username,
              display_name: profilesById.get(f.requester_id)!.display_name,
              avatar_url: profilesById.get(f.requester_id)!.avatar_url,
              status: profilesById.get(f.requester_id)!.status,
            }
          : null,
      }))
    );
  }, [user]);

  useEffect(() => {
    void load();
  }, [load, friendsTick]);

  async function addFriend(username: string) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("send_friend_request", {
      p_username: username,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Pedido enviado.");
    await load();
    onChanged?.();
  }

  async function respond(id: string, accept: boolean) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("respond_friend_request", {
      p_friendship_id: id,
      p_accept: accept,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus(accept ? "Amizade aceita." : "Pedido recusado.");
    await load();
    onChanged?.();
  }

  async function remove(userId: string) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc("remove_friend", {
      p_user_id: userId,
    });
    setBusy(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Amigo removido.");
    await load();
    onChanged?.();
  }

  return (
    <>
      <div className="friends-panel">
        <div className="friends-header">
          <div>
            <div className="brand panel-brand">
              <IconFriends /> Amigos
            </div>
            <p className="muted panel-brand-sub panel-brand-sub-flush">
              Conversas privadas só entre amigos.
            </p>
          </div>
          <button
            className="neo-btn neo-btn-primary"
            type="button"
            onClick={() => setAddOpen(true)}
          >
            <IconPlus /> Adicionar
          </button>
        </div>

        {status && <p className="muted status-note">{status}</p>}

        {pending.length > 0 && (
          <section className="friends-section">
            <div className="section-label">Pedidos recebidos</div>
            {pending.map((p) => (
              <PersonRow key={p.id} person={p.requester}>
                <button className="neo-btn neo-btn-primary" type="button" disabled={busy} onClick={() => void respond(p.id, true)}>
                  Aceitar
                </button>
                <button className="neo-btn neo-btn-danger" type="button" disabled={busy} onClick={() => void respond(p.id, false)}>
                  Recusar
                </button>
              </PersonRow>
            ))}
          </section>
        )}

        <section className="friends-section">
          <div className="section-label">Todos os amigos — {friends.length}</div>
          {friends.length === 0 && (
            <EmptyState
              art="friends"
              title="Nenhum amigo ainda"
              hint="Adicione alguém pelo @username para conversar no privado."
            />
          )}
          {friends.map((f) => (
            <PersonRow key={f.friendship_id} person={f.user}>
              <button className="neo-btn neo-btn-primary" type="button" onClick={() => onOpenDm(f.user)}>
                Mensagem
              </button>
              <button className="neo-btn neo-btn-danger" type="button" disabled={busy} onClick={() => void remove(f.user.id)}>
                Remover
              </button>
            </PersonRow>
          ))}
        </section>
      </div>

      <PromptModal
        open={addOpen}
        title="Adicionar amigo"
        label="Username"
        placeholder="ex: fulano"
        confirmLabel="Enviar pedido"
        onClose={() => setAddOpen(false)}
        onConfirm={(username) => void addFriend(username)}
      />
    </>
  );
}
