import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { conversations, customers, customerThread, myThread, sendToCompany, sendToCustomer, type User } from "../services/api";
import type { ChatMessage, Conversation, CustomerSummary } from "../services/types";
import { dayKey, errorMessage, formatDay, formatTime } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { t } from "../i18n";
import { EmptyState, Loading } from "./States";
import "./Messages.css";

const MAX_LENGTH = 2000;

/**
 * The chat between customers and the company's managers: quotes, questions, changes of plan.
 * A manager has every customer's conversation; a customer has theirs. Checked every 15 seconds.
 */
export default function Messages({ user, customerId }: { user: User; customerId?: number | null }) {
  return user.role === "boss" ? <ManagerInbox initial={customerId ?? null} /> : <CustomerChat />;
}

function CustomerChat() {
  const [company, setCompany] = useState("");
  return (
    <Thread
      title={company ? t("Chat with {company}", { company }) : t("Chat")}
      hint={t("Ask for a quote, change a visit, or ask anything. The team replies here, and you'll get a notification.")}
      load={() =>
        myThread().then((data) => {
          setCompany(data.company);
          return data.messages;
        })
      }
      send={sendToCompany}
      reload="mine"
    />
  );
}

function ManagerInbox({ initial }: { initial: number | null }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [customerList, setCustomerList] = useState<CustomerSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(initial);
  const [error, setError] = useState("");
  const load = () =>
    conversations()
      .then((data) => {
        setList(data.conversations ?? []);
        setError("");
      })
      .catch((problem) => setError(errorMessage(problem)));
  usePolling(load, 15000, true);
  useEffect(() => {
    customers()
      .then((data) => setCustomerList(data.customers))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (initial) setSelected(initial);
  }, [initial]);

  const talkedTo = new Set((list ?? []).map((row) => row.customer_id));
  const others = customerList.filter((customer) => !talkedTo.has(customer.id));
  const current = selected ? ((list ?? []).find((row) => row.customer_id === selected)?.customer ?? customerList.find((c) => c.id === selected)?.name ?? "") : "";
  return (
    <div className={`inbox ${selected ? "showingThread" : ""}`}>
      <aside className="inboxList" aria-label={t("Conversations")}>
        {error && <div className="error">{error}</div>}
        {others.length > 0 && (
          <label className="inboxNew">
            <span>{t("New conversation")}</span>
            <select value="" onChange={(event) => event.target.value && setSelected(Number(event.target.value))}>
              <option value="">{t("Choose a customer")}</option>
              {others.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {list === null ? (
          !error && <Loading />
        ) : list.length === 0 ? (
          <p className="muted inboxEmpty">{t("No messages yet. Customers can write to you from their app.")}</p>
        ) : (
          <ul>
            {list.map((row) => (
              <li key={row.customer_id}>
                <button className={`${row.customer_id === selected ? "chosen" : ""} ${row.unread ? "unread" : ""}`} onClick={() => setSelected(row.customer_id)}>
                  <span className="inboxAvatar" aria-hidden="true">
                    {row.customer[0]}
                  </span>
                  <span className="inboxText">
                    <strong>{row.customer}</strong>
                    <small>
                      {row.last.from_customer ? "" : `${t("You")}: `}
                      {row.last.body}
                    </small>
                  </span>
                  <span className="inboxMeta">
                    <small>{formatTime(row.last.created_at)}</small>
                    {row.unread > 0 && <b aria-label={t("{count} unread", { count: row.unread })}>{row.unread}</b>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {selected ? (
        <Thread
          key={selected}
          title={current}
          onBack={() => setSelected(null)}
          load={() => customerThread(selected).then((data) => data.messages)}
          send={(body) => sendToCustomer(selected, body)}
          reload={String(selected)}
          onChanged={load}
        />
      ) : (
        <div className="threadPlaceholder">
          <EmptyState icon={<MessageSquare size={26} />} title={t("Pick a conversation")} text={t("Quotes, questions and changes of plan with your customers.")} />
        </div>
      )}
    </div>
  );
}

type ThreadProps = {
  title: string;
  hint?: string;
  load: () => Promise<ChatMessage[]>;
  send: (body: string) => Promise<unknown>;
  /** Changes when the thread shown changes. */
  reload: string;
  onBack?: () => void;
  onChanged?: () => void;
};

function Thread({ title, hint, load, send, reload, onBack, onChanged }: ThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  const refresh = () =>
    load()
      .then((rows) => {
        setMessages(rows);
        onChanged?.();
      })
      .catch((problem) => setError(errorMessage(problem)));
  usePolling(refresh, 15000);
  useEffect(() => {
    setMessages(null);
    count.current = 0;
  }, [reload]);
  useEffect(() => {
    // Keep the newest message in view as messages arrive.
    if (messages && messages.length !== count.current) {
      count.current = messages.length;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await send(body);
      setDraft("");
      await refresh();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="thread" aria-label={title}>
      <header className="threadHead">
        {onBack && (
          <button className="link threadBack" onClick={onBack}>
            {t("Back")}
          </button>
        )}
        <div>
          <h2>{title}</h2>
          {hint && <p className="muted">{hint}</p>}
        </div>
      </header>
      <div className="threadMessages" role="log" aria-live="polite">
        {messages === null ? (
          !error && <Loading />
        ) : messages.length === 0 ? (
          <p className="muted threadEmpty">{t("No messages yet. Say hello.")}</p>
        ) : (
          messages.map((message, index) => {
            const newDay = index === 0 || dayKey(messages[index - 1].created_at) !== dayKey(message.created_at);
            return (
              <div key={message.id} className="threadItem">
                {newDay && <p className="threadDay">{formatDay(message.created_at)}</p>}
                <div className={`bubble ${message.mine ? "mine" : ""}`}>
                  {!message.mine && message.sender && <strong>{message.sender}</strong>}
                  <p>{message.body}</p>
                  <small>{formatTime(message.created_at)}</small>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>
      <form className="threadComposer" onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        <label className="visuallyHidden" htmlFor="message-body">
          {t("Message")}
        </label>
        <textarea
          id="message-body"
          value={draft}
          maxLength={MAX_LENGTH}
          rows={2}
          placeholder={t("Write a message…")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="primary" disabled={busy || !draft.trim()} aria-label={t("Send")}>
          <Send size={16} /> <span>{t("Send")}</span>
        </button>
      </form>
    </section>
  );
}
