-- Claudesaurus for Rex: command palette actions that open Claudesaurus in a new pane beside or
-- below the focused one, working in that pane's folder.
--
-- Claudesaurus installs this itself when it runs or with `claudesaurus --setup`: it copies this
-- file to plugins/claudesaurus/init.lua in Rex's config folder and loads it from init.lua with
--
--   dofile("/path/to/plugins/claudesaurus/init.lua").setup({ command = { "/path/to/claudesaurus" } })
--
-- `claudesaurus --remove-rex-actions` takes it out again.

local M = {}

local SHELL = "com.superlogical.terminal.shell"
local TERMINAL = "com.superlogical.terminal"

local function file_path(url)
  if type(url) ~= "string" then return nil end
  local path = url:match("^file://[^/]*(/.*)$")
  if path == nil then return nil end
  return (path:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end))
end

-- Where the program in front of the pane works, or else where its shell last was.
local function cwd(ctx)
  if ctx.block_id == nil then return nil end
  local info = rex.block.call(TERMINAL, "process", { block_id = ctx.block_id })
  if type(info) == "table" and type(info.foreground) == "table"
    and type(info.foreground.cwd) == "string" and info.foreground.cwd ~= "" then
    return info.foreground.cwd
  end
  local pwd = rex.block.call(TERMINAL, "pwd", { block_id = ctx.block_id })
  if type(pwd) ~= "table" then return nil end
  return file_path(pwd.pwd)
end

-- "horizontal" puts the new pane beside the focused one, "vertical" below it.
local function open(ctx, command, direction)
  local options = { command = command }
  local dir = cwd(ctx)
  if dir ~= nil and dir ~= "" then options.cwd = dir end
  local layout = { block = { flavor = SHELL, label = "Claudesaurus", options = options } }
  local _, err
  if ctx.block_id == nil then
    _, err = rex.session.new_window{ label = "Claudesaurus", layout = layout, focus = true }
  else
    _, err = rex.session.new_split{
      anchor_id = ctx.block_id,
      direction = direction,
      side = "after",
      focus = true,
      layout = layout,
    }
  end
  if err ~= nil then error("claudesaurus: couldn't open a pane: " .. tostring(err), 0) end
end

function M.setup(opts)
  local command = (opts or {}).command or { "claudesaurus" }
  if not (rex and rex.action) then return end
  rex.action{
    name = "claudesaurus_split_horizontal",
    title = "Claudesaurus: Open in Horizontal Split",
    description = "Open Claudesaurus in a new pane to the right, in this pane's folder",
    category = "Claudesaurus",
    keywords = "claude chat split right beside side by side",
    run = function(ctx) open(ctx, command, "horizontal") end,
  }
  rex.action{
    name = "claudesaurus_split_vertical",
    title = "Claudesaurus: Open in Vertical Split",
    description = "Open Claudesaurus in a new pane below, in this pane's folder",
    category = "Claudesaurus",
    keywords = "claude chat split below under stacked",
    run = function(ctx) open(ctx, command, "vertical") end,
  }
end

return M
