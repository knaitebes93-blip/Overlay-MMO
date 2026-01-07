import React from "react";
import { TextWidget as TextWidgetType } from "../../shared/ipc";

type Props = {
  widget: TextWidgetType;
};

const TextWidget = ({ widget }: Props) => {
  return (
    <div className="widget">
      {widget.title && <h3>{widget.title}</h3>}
      <p>{widget.text}</p>
    </div>
  );
};

export default TextWidget;
