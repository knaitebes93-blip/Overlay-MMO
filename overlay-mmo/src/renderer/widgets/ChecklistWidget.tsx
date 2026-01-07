import React, { useState } from "react";
import { ChecklistWidget as ChecklistWidgetType } from "../../shared/ipc";

type Props = {
  widget: ChecklistWidgetType;
  onChange: (next: ChecklistWidgetType) => void;
};

const ChecklistWidget = ({ widget, onChange }: Props) => {
  const [draft, setDraft] = useState("");

  const addItem = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    onChange({
      ...widget,
      items: [
        ...widget.items,
        { id: `item-${Date.now()}`, text, checked: false }
      ]
    });
    setDraft("");
  };

  const toggleItem = (id: string) => {
    onChange({
      ...widget,
      items: widget.items.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    });
  };

  const removeItem = (id: string) => {
    onChange({
      ...widget,
      items: widget.items.filter((item) => item.id !== id)
    });
  };

  return (
    <div className="widget">
      {widget.title && <h3>{widget.title}</h3>}
      <ul className="checklist">
        {widget.items.map((item) => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggleItem(item.id)}
              />
              <span className={item.checked ? "checked" : ""}>{item.text}</span>
            </label>
            <button type="button" onClick={() => removeItem(item.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="checklist-add">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New checklist item"
        />
        <button type="button" onClick={addItem}>
          Add
        </button>
      </div>
    </div>
  );
};

export default ChecklistWidget;
