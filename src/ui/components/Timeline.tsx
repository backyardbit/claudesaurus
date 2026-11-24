import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { memo } from "react";
import type { Item, PermissionRequest } from "../store";
import { Markdown } from "./Markdown";
import { Permission } from "./Permission";
import { Thought } from "./Thought";
import { ToolCall } from "./ToolCall";

function NoticeIcon({ severity }: { severity: string }) {
  if (severity === "error") return <CircleAlert size={15} />;
  if (severity === "warning") return <TriangleAlert size={15} />;
  return <Info size={15} />;
}

type ItemListProps = {
  items: Item[];
  permissions: PermissionRequest[];
  /** True while Claude is still writing the last item. */
  streaming: boolean;
};

function ItemList({ items, permissions, streaming }: ItemListProps) {
  return items.map((item, index) => (
    <ItemView
      key={item.id}
      item={item}
      permissions={permissions}
      streaming={streaming && index === items.length - 1}
    />
  ));
}

type ItemViewProps = { item: Item; permissions: PermissionRequest[]; streaming: boolean };

/**
 * One entry of the conversation. An item object is replaced only when it changes, so memoizing on
 * it keeps a long conversation from being redrawn for every piece of streamed text.
 */
const ItemView = memo(function ItemView({ item, permissions, streaming }: ItemViewProps) {
  switch (item.kind) {
    case "user":
      return (
        <div className="user">
          <div className="bubble">
            {item.images.map((image) => (
              <img
                key={image.data.slice(0, 48)}
                src={`data:${image.mimeType};base64,${image.data}`}
                alt="Attachment"
              />
            ))}
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return <Markdown text={item.text} streaming={streaming} />;
    case "thought":
      return (
        <Thought
          text={item.text}
          startedAt={item.startedAt}
          endedAt={item.endedAt}
          timed={item.timed}
        />
      );
    case "tool":
      return (
        <div>
          <ToolCall
            tool={item.tool}
            renderChildren={(children) => (
              <ItemList items={children} permissions={permissions} streaming={streaming} />
            )}
          />
          {permissions
            .filter((request) => request.toolCall.toolCallId === item.tool.toolCallId)
            .map((request) => (
              <Permission key={request.requestId} request={request} />
            ))}
        </div>
      );
    case "notice":
      return (
        <div className={`notice ${item.severity}`}>
          <NoticeIcon severity={item.severity} />
          <div>
            <strong>{item.title}</strong>
            {item.description && <div>{item.description}</div>}
          </div>
        </div>
      );
    default:
      return (
        <div className="notice error">
          <CircleAlert size={15} />
          <div>{item.message}</div>
        </div>
      );
  }
});

function toolCallIds(items: Item[], found = new Set<string>()) {
  for (const item of items) {
    if (item.kind !== "tool") continue;
    found.add(item.tool.toolCallId);
    toolCallIds(item.tool.children, found);
  }
  return found;
}

type TimelineProps = {
  items: Item[];
  permissions: PermissionRequest[];
  /** True while a turn is running. */
  running: boolean;
};

export function Timeline({ items, permissions, running }: TimelineProps) {
  const known = permissions.length > 0 ? toolCallIds(items) : null;
  const orphans = permissions.filter((request) => !known?.has(request.toolCall.toolCallId));
  return (
    <>
      <ItemList items={items} permissions={permissions} streaming={running} />
      {orphans.map((request) => (
        <Permission key={request.requestId} request={request} />
      ))}
    </>
  );
}
