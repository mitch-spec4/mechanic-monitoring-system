import { Fragment, type ReactNode } from "react";
import { t } from ".";

/** A translated sentence with parts that aren't plain text, such as a bold name:
 *  <Trans text="Share this code with {name}." values={{ name: <b>{person}</b> }} />
 *  The whole sentence is translated as one, so its word order can change in another language. */
export function Trans({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const pieces = t(text).split(/(\{\w+\})/);
  return (
    <>
      {pieces.map((piece, index) => {
        const key = /^\{(\w+)\}$/.exec(piece)?.[1];
        return <Fragment key={index}>{key && key in values ? values[key] : piece}</Fragment>;
      })}
    </>
  );
}
