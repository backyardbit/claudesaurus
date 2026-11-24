import { ShieldQuestion } from "lucide-react";
import { type PermissionRequest, useActions } from "../store";

const REJECT_KINDS = new Set(["reject_once", "reject_always"]);

export function Permission({ request }: { request: PermissionRequest }) {
  const actions = useActions();
  return (
    <div className="permission">
      <div className="permission-title">
        <ShieldQuestion size={15} />
        <span>{request.toolCall.title ?? "Claude wants to use a tool"}</span>
      </div>
      <div className="permission-options">
        {request.options.map((option, index) => (
          <button
            type="button"
            key={option.optionId}
            className={REJECT_KINDS.has(option.kind) ? "button" : "button primary"}
            onClick={() => actions.answerPermission(request.requestId, option.optionId)}
          >
            <kbd>{index + 1}</kbd> {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
