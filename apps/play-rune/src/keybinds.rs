//! Remappable 7K lane keybinds (physical keys, GPUIX-compatible names).

use rune::PhysicalKeyCode;

pub const DEFAULT_LANE_KEYS: [&str; 7] = ["s", "d", "f", "space", "j", "k", "l"];

pub fn normalize_key_name(raw: &str) -> Option<String> {
    let t = raw.trim().to_ascii_lowercase();
    if t.is_empty() {
        return None;
    }
    let name = match t.as_str() {
        " " | "spacebar" => "space",
        other => other,
    };
    if physical_from_name(name).is_some() {
        Some(name.to_string())
    } else {
        None
    }
}

pub fn physical_from_name(name: &str) -> Option<PhysicalKeyCode> {
    use PhysicalKeyCode::*;
    Some(match name {
        "a" => KeyA,
        "b" => KeyB,
        "c" => KeyC,
        "d" => KeyD,
        "e" => KeyE,
        "f" => KeyF,
        "g" => KeyG,
        "h" => KeyH,
        "i" => KeyI,
        "j" => KeyJ,
        "k" => KeyK,
        "l" => KeyL,
        "m" => KeyM,
        "n" => KeyN,
        "o" => KeyO,
        "p" => KeyP,
        "q" => KeyQ,
        "r" => KeyR,
        "s" => KeyS,
        "t" => KeyT,
        "u" => KeyU,
        "v" => KeyV,
        "w" => KeyW,
        "x" => KeyX,
        "y" => KeyY,
        "z" => KeyZ,
        "0" => Digit0,
        "1" => Digit1,
        "2" => Digit2,
        "3" => Digit3,
        "4" => Digit4,
        "5" => Digit5,
        "6" => Digit6,
        "7" => Digit7,
        "8" => Digit8,
        "9" => Digit9,
        "space" => Space,
        "enter" => Enter,
        "tab" => Tab,
        "minus" => Minus,
        "equal" => Equal,
        "comma" => Comma,
        "period" => Period,
        "slash" => Slash,
        "semicolon" => Semicolon,
        "quote" => Quote,
        "bracketleft" => BracketLeft,
        "bracketright" => BracketRight,
        "backslash" => Backslash,
        "backquote" => Backquote,
        _ => return None,
    })
}

pub fn name_from_physical(code: PhysicalKeyCode) -> Option<&'static str> {
    use PhysicalKeyCode::*;
    Some(match code {
        KeyA => "a",
        KeyB => "b",
        KeyC => "c",
        KeyD => "d",
        KeyE => "e",
        KeyF => "f",
        KeyG => "g",
        KeyH => "h",
        KeyI => "i",
        KeyJ => "j",
        KeyK => "k",
        KeyL => "l",
        KeyM => "m",
        KeyN => "n",
        KeyO => "o",
        KeyP => "p",
        KeyQ => "q",
        KeyR => "r",
        KeyS => "s",
        KeyT => "t",
        KeyU => "u",
        KeyV => "v",
        KeyW => "w",
        KeyX => "x",
        KeyY => "y",
        KeyZ => "z",
        Digit0 => "0",
        Digit1 => "1",
        Digit2 => "2",
        Digit3 => "3",
        Digit4 => "4",
        Digit5 => "5",
        Digit6 => "6",
        Digit7 => "7",
        Digit8 => "8",
        Digit9 => "9",
        Space => "space",
        Enter => "enter",
        Tab => "tab",
        Minus => "minus",
        Equal => "equal",
        Comma => "comma",
        Period => "period",
        Slash => "slash",
        Semicolon => "semicolon",
        Quote => "quote",
        BracketLeft => "bracketleft",
        BracketRight => "bracketright",
        Backslash => "backslash",
        Backquote => "backquote",
        _ => return None,
    })
}

pub fn format_key_label(name: &str) -> String {
    if name == "space" {
        return "Space".into();
    }
    if name.len() == 1 {
        return name.to_ascii_uppercase();
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
        None => name.to_string(),
    }
}

pub fn format_bindings_hint(keys: &[String; 7]) -> String {
    keys.iter()
        .map(|k| format_key_label(k))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn lane_for_physical(code: PhysicalKeyCode, keys: &[String; 7]) -> Option<u8> {
    let Some(name) = name_from_physical(code) else {
        return None;
    };
    keys.iter()
        .position(|k| k == name)
        .map(|i| i as u8)
}

pub fn default_lane_keys() -> [String; 7] {
    DEFAULT_LANE_KEYS.map(|s| s.to_string())
}
