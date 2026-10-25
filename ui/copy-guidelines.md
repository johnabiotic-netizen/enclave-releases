# UI copy guidelines

The owner cares a lot about copy that reads naturally and does not look machine written. Apply these everywhere: buttons, labels, errors, empty states, onboarding.

## Voice
- Plain, calm, direct. Short sentences. Sentence case.
- Name things by what the user understands, not by how the system works. "Exit IP" is fine (users of this tool know it); "container" is not (say "profile").
- Active voice. A button says what happens: "Start profile", "Create profile", "Stop sharing".
- The action keeps its name through the flow: the "Start" button leads to a "Running" state, not "Active".

## Hard rules (owner preferences)
- No em dashes and no hyphens used as dashes in sentences. Rewrite instead.
- Avoid tidy three part lists and slogans. Vary sentence shape.
- Do not pad with filler ("simply", "just", "seamlessly", "effortlessly").
- No all caps labels. No arrows stuck on button text.

## Errors
State what happened and what to do, in the interface's voice, no apology, never vague.
- Good: "Proxy unreachable. Check the proxy details or try again."
- Good: "That proxy connected, but its location is Germany while this profile is set to the US. Update the location or use a US proxy."
- Bad: "Oops! Something went wrong."

## Empty states
An invitation to act, not decoration.
- Dashboard empty: "No profiles yet. Create your first sealed profile to get started." + Create button.

## Onboarding / setup
Tell the user what is happening and how long it takes.
- First build: "Setting up your secure browser. This happens once and takes about 5 to 10 minutes. You can leave this open."

## Examples of button text
Create profile · Start profile · Open · Open on phone · Stop · Check proxy · Update location · Pair a phone · Revoke

## Don't say (legal and honesty)
Undetectable, bypass, unlimited accounts, avoid bans, pass verification. See `docs/08-legal-and-acceptable-use.md`.
