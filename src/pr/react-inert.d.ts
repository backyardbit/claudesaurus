import "react";

// React 18's types leave out `inert`, which the ported T3 Code panel uses to take folded chrome
// out of the tab order. React 18 passes it through as an attribute when it is a string.
declare module "react" {
  interface HTMLAttributes<T> {
    inert?: "" | undefined;
  }
}
