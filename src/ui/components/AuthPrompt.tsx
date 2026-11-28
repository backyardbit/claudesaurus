import { Copy, KeyRound, RotateCw } from "lucide-react";
import type { AuthRequest } from "../../shared/protocol";
import { useActions } from "../store";

export function AuthPrompt({ agentName, auth }: { agentName: string; auth: AuthRequest }) {
  const actions = useActions();
  return (
    <div className="permission auth">
      <div className="permission-title">
        <KeyRound size={15} />
        <span>Sign in to {agentName}</span>
      </div>
      <div className="dim auth-status">
        {auth.status ?? `${agentName} needs you to sign in before it can start. Pick how:`}
      </div>
      {auth.command && (
        <div className="auth-command">
          <code>{auth.command}</code>
          <button
            type="button"
            className="icon-button"
            title="Copy"
            onClick={() => actions.copy(auth.command ?? "", "Command copied")}
          >
            <Copy size={13} />
          </button>
        </div>
      )}
      <div className="permission-options">
        {auth.methods.map((method, index) => (
          <button
            type="button"
            key={method.id}
            className={index === 0 ? "button primary" : "button"}
            title={method.description ?? undefined}
            onClick={() => actions.authenticate(method.id)}
          >
            <kbd>{index + 1}</kbd> {method.name}
          </button>
        ))}
        <button type="button" className="button" onClick={actions.retryAuth}>
          <RotateCw size={13} /> Try again
        </button>
      </div>
    </div>
  );
}
