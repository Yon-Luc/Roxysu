using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace ManiaDifficulty.Transpiler;

/// <summary>
/// Constrained C# → TypeScript translator for mania difficulty sources.
/// </summary>
public sealed class TypeScriptTranslator
{
    private readonly string _sourceRelative;
    private readonly RevisionInfo _revision;
    private readonly List<string> _diagnostics;
    private readonly HashSet<string> _imports = new(StringComparer.Ordinal);
    private readonly HashSet<string> _boundPatternNames = new(StringComparer.Ordinal);
    private readonly Stack<HashSet<string>> _patternScopes = new();
    private readonly HashSet<string> _locals = new(StringComparer.Ordinal);
    private readonly HashSet<string> _nullableValueLocals = new(StringComparer.Ordinal);
    private readonly HashSet<string> _intNames = new(StringComparer.Ordinal);
    private int _indent;
    private string _typeName = "Generated";
    private string _outRel = "";
    private MethodDeclarationSyntax? _currentMethod;
    private bool _yieldMode;
    private static readonly HashSet<string> ReservedJs = new(StringComparer.Ordinal)
    {
        "function", "class", "return", "var", "let", "const", "default", "new", "delete",
        "typeof", "instanceof", "throw", "catch", "switch", "case", "break", "continue",
        "import", "export", "extends", "yield", "await", "enum", "implements", "interface",
        "package", "private", "protected", "public", "static", "with", "void", "null", "true",
        "false", "this", "super", "debugger", "arguments",
    };

    // type name → generated module path (no extension, under generated/)
    private static readonly Dictionary<string, string> GeneratedModules = new(StringComparer.Ordinal)
    {
        ["DiffUtils"] = "osu.Game/Rulesets/Difficulty/Utils/DiffUtils",
        ["RunDampenUtils"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/RunDampenUtils",
        ["ColumnPatternUtils"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnPatternUtils",
        ["CrossColumnUtils"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/CrossColumnUtils",
        ["ChordUtils"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils",
        ["TrillUtils"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/TrillUtils",
        ["ColumnRunUtils"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnRunUtils",
        ["RootFinding"] = "osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding",
        ["SpeedEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/SpeedEvaluator",
        ["TechnicalEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/TechnicalEvaluator",
        ["CoordinationEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/CoordinationEvaluator",
        ["JackEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/JackEvaluator",
        ["ReleaseEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/ReleaseEvaluator",
        ["AnchorEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/AnchorEvaluator",
        ["FullChordJackEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/FullChordJackEvaluator",
        ["JackSpacingEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/JackSpacingEvaluator",
        ["SpeedjackEvaluator"] = "osu.Game.Rulesets.Mania/Difficulty/Evaluators/Jack/SpeedjackEvaluator",
    };

    // type name → handwritten adapter path relative to package root (src/…)
    private static readonly Dictionary<string, string> ShimModules = new(StringComparer.Ordinal)
    {
        ["ManiaDifficultyHitObject"] = "src/adapters/hitObject",
        ["ManiaRow"] = "src/adapters/hitObject",
    };

    public TypeScriptTranslator(string sourceRelative, RevisionInfo revision, List<string> diagnostics)
    {
        _sourceRelative = sourceRelative.Replace('\\', '/');
        _revision = revision;
        _diagnostics = diagnostics;
        _outRel = _sourceRelative.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)
            ? _sourceRelative[..^3] + ".ts"
            : _sourceRelative + ".ts";
    }

    private StringBuilder _emit = new();

    public string Translate(CompilationUnitSyntax root)
    {
        _imports.Clear();
        _indent = 0;

        // Phase 1: body (collects imports)
        var bodySb = new StringBuilder();
        _emit = bodySb;
        foreach (var ns in root.Members.OfType<BaseNamespaceDeclarationSyntax>())
        {
            foreach (var type in ns.Members.OfType<TypeDeclarationSyntax>())
                TranslateType(type);
        }

        foreach (var type in root.Members.OfType<TypeDeclarationSyntax>())
            TranslateType(type);

        var bodyText = bodySb.ToString();

        // Phase 2: header + body
        _emit = new StringBuilder();
        EmitLine($"// @generated from {_sourceRelative}");
        EmitLine($"// upstream sha: {_revision.Sha}");
        EmitLine($"// generator: {_revision.GeneratorVersion}");
        EmitLine("// Do not edit by hand — regenerate with: bun run port:generate");
        EmitLine("");

        foreach (var imp in _imports.OrderBy(x => x, StringComparer.Ordinal))
            EmitLine(imp);

        if (_imports.Count > 0)
            EmitLine("");

        _emit.Append(bodyText);
        return _emit.ToString();
    }

    private void TranslateType(TypeDeclarationSyntax type)
    {
        if (type is not ClassDeclarationSyntax cls)
        {
            // readonly struct / struct — skip with error for now unless empty
            Error(type, $"Unsupported type kind: {type.Kind()} (only classes)");
            return;
        }

        _typeName = cls.Identifier.Text;

        // Private static/const → module-level; public const → object props (+ re-export)
        var publicConsts = new List<(string Name, string Value)>();
        foreach (var field in cls.Members.OfType<FieldDeclarationSyntax>())
        {
            var isConst = field.Modifiers.Any(m => m.IsKind(SyntaxKind.ConstKeyword));
            var isStatic = field.Modifiers.Any(m => m.IsKind(SyntaxKind.StaticKeyword));
            var isReadonly = field.Modifiers.Any(m => m.IsKind(SyntaxKind.ReadOnlyKeyword));
            var isPublic = field.Modifiers.Any(m => m.IsKind(SyntaxKind.PublicKeyword));
            if (!isConst && !(isStatic && isReadonly))
            {
                if (isStatic)
                    Error(field, "non-readonly static fields not supported");
                continue;
            }

            foreach (var v in field.Declaration.Variables)
            {
                if (v.Initializer == null)
                {
                    Error(v, "field without initializer");
                    continue;
                }

                var name = v.Identifier.Text;
                var value = Expr(v.Initializer.Value);
                // Always module-level so default params / peers can reference bare names.
                var kw = isPublic ? "export const" : "const";
                EmitLine($"{kw} {name} = {value};");
                if (isPublic && isConst)
                    publicConsts.Add((name, name)); // object prop aliases module const
            }
        }

        EmitLine("");
        EmitLine($"/** Generated from C# class {_typeName} */");
        EmitLine($"export const {_typeName} = {{");
        Indent();

        foreach (var (name, value) in publicConsts)
            EmitLine($"{name},");

        if (publicConsts.Count > 0)
            EmitLine("");

        var methods = cls.Members.OfType<MethodDeclarationSyntax>().ToList();
        var groups = methods.GroupBy(m => m.Identifier.Text).ToList();

        for (var gi = 0; gi < groups.Count; gi++)
        {
            var group = groups[gi].ToList();
            var isLast = gi == groups.Count - 1;
            if (group.Count == 1)
                TranslateSingleMethod(group[0], group[0].Identifier.Text, isLast);
            else
                TranslateOverloadGroup(group, isLast);
        }

        foreach (var member in cls.Members)
        {
            if (member is MethodDeclarationSyntax or FieldDeclarationSyntax)
                continue;
            if (member is PropertyDeclarationSyntax prop)
            {
                // skip auto expression properties that are just aliases — error for now
                if (prop.ExpressionBody != null)
                {
                    Error(prop, $"property not supported: {prop.Identifier.Text}");
                }

                continue;
            }

            if (member is TypeDeclarationSyntax or ConstructorDeclarationSyntax)
                Error(member, $"Unsupported class member: {member.Kind()}");
        }

        Dedent();
        EmitLine("};");
        EmitLine("");
        EmitLine($"export default {_typeName};");
    }

    private void TranslateOverloadGroup(List<MethodDeclarationSyntax> group, bool isLast)
    {
        var name = group[0].Identifier.Text;
        for (var i = 0; i < group.Count; i++)
        {
            var m = group[i];
            var implName = $"_{name}_a{m.ParameterList.Parameters.Count}_{i}";
            TranslateSingleMethod(m, implName, isLast: false);
        }

        var ret = MapType(group[0].ReturnType);
        EmitLine($"{name}(...args: number[]): {ret} {{");
        Indent();
        var byArity = group
            .Select((m, i) => (m, i, n: m.ParameterList.Parameters.Count))
            .GroupBy(x => x.n)
            .OrderByDescending(g => g.Key)
            .ToList();

        foreach (var arityGroup in byArity)
        {
            var first = arityGroup.First();
            var implName = $"_{name}_a{first.n}_{first.i}";
            var required = first.m.ParameterList.Parameters.Count(p => p.Default == null);
            var total = first.n;
            var paramsList = first.m.ParameterList.Parameters.ToList();
            EmitLine($"if (args.length >= {required} && args.length <= {total}) {{");
            Indent();
            var callArgs = new List<string>();
            for (var pi = 0; pi < total; pi++)
            {
                var p = paramsList[pi];
                if (p.Default != null)
                    callArgs.Add($"args[{pi}] !== undefined ? args[{pi}]! : {Expr(p.Default.Value)}");
                else
                    callArgs.Add($"args[{pi}]!");
            }

            EmitLine($"return {_typeName}.{implName}({string.Join(", ", callArgs)});");
            Dedent();
            EmitLine("}");
        }

        EmitLine($"throw new Error(\"{_typeName}.{name}: no overload for \" + args.length + \" args\");");
        Dedent();
        EmitLine(isLast ? "}," : "},");
        EmitLine("");
    }

    private void TranslateSingleMethod(MethodDeclarationSyntax method, string emitName, bool isLast)
    {
        var parameters = method.ParameterList.Parameters;
        var paramList = new List<string>();
        _locals.Clear();
        _boundPatternNames.Clear();
        _patternScopes.Clear();
        _patternScopes.Push(new HashSet<string>(StringComparer.Ordinal));
        _nullableValueLocals.Clear();
        _intNames.Clear();
        _currentMethod = method;
        _yieldMode = method.Body != null &&
                     method.Body.DescendantNodes().OfType<YieldStatementSyntax>().Any();

        foreach (var p in parameters)
        {
            if (p.Modifiers.Any(m => m.IsKind(SyntaxKind.OutKeyword) || m.IsKind(SyntaxKind.RefKeyword)))
            {
                Error(p, $"ref/out parameter not supported: {p.Identifier.Text}");
                return;
            }

            var pname = SafeName(p.Identifier.Text);
            _locals.Add(p.Identifier.Text);
            _locals.Add(pname);
            if (IsIntegerType(p.Type))
            {
                _intNames.Add(p.Identifier.Text);
                _intNames.Add(pname);
            }

            if (p.Modifiers.Any(m => m.IsKind(SyntaxKind.ParamsKeyword)))
            {
                paramList.Add($"...{pname}: {MapType(p.Type)}");
                continue;
            }

            NoteTypeUsage(p.Type);
            var typeStr = MapType(p.Type);
            var def = p.Default != null ? $" = {Expr(p.Default.Value)}" : "";
            paramList.Add($"{pname}: {typeStr}{def}");
        }

        var retType = _yieldMode ? "number[]" : MapType(method.ReturnType);
        EmitLine($"{emitName}({string.Join(", ", paramList)}): {retType} {{");
        Indent();

        if (_yieldMode)
            EmitLine("const __yield: number[] = [];");

        if (method.Body != null)
        {
            foreach (var stmt in method.Body.Statements)
                TranslateStatement(stmt);
            if (_yieldMode)
                EmitLine("return __yield;");
        }
        else if (method.ExpressionBody != null)
        {
            EmitLine($"return {Expr(method.ExpressionBody.Expression)};");
        }
        else
        {
            Error(method, "method has no body");
        }

        Dedent();
        EmitLine(isLast ? "}," : "},");
        EmitLine("");
        _currentMethod = null;
        _yieldMode = false;
    }

    private static string SafeName(string name) =>
        ReservedJs.Contains(name) ? name + "_" : name;

    private void TranslateStatement(StatementSyntax stmt)
    {
        switch (stmt)
        {
            case LocalDeclarationStatementSyntax local:
                // var (a, b) = expr;
                if (local.Declaration.Variables.Count == 1 &&
                    local.Declaration.Variables[0].Initializer != null &&
                    local.Declaration.Type is TupleTypeSyntax tupleType)
                {
                    var v = local.Declaration.Variables[0];
                    EmitPatternBindings(v.Initializer!.Value);
                    var tmp = "__tup";
                    EmitLine($"const {tmp} = {Expr(v.Initializer.Value)};");
                    var i = 0;
                    foreach (var el in tupleType.Elements)
                    {
                        var n = el.Identifier.Text;
                        if (string.IsNullOrEmpty(n))
                            n = $"item{i + 1}";
                        n = SafeName(n);
                        _locals.Add(n);
                        EmitLine($"const {n} = {tmp}.{n};");
                        i++;
                    }
                    break;
                }

                // Deconstruction: var (a, b) = foo() via ParenthesizedVariableDesignation
                if (local.Declaration.Variables.Count >= 1)
                {
                    // handled below for single vars; multi-designation:
                }

                foreach (var v in local.Declaration.Variables)
                {
                    if (v.Initializer != null)
                        EmitPatternBindings(v.Initializer.Value);

                    // DeclarationExpression-style designation not on VariableDeclarator —
                    // handle `var (a, b) = x` when Type is not TupleType but designation is:
                    if (v.Initializer != null &&
                        local.Declaration.Type is TupleTypeSyntax)
                    {
                        continue; // already handled
                    }

                    var init = v.Initializer != null ? $" = {Expr(v.Initializer.Value)}" : "";
                    var kw = local.IsConst ? "const" : "let";
                    var name = SafeName(v.Identifier.Text);
                    if (string.IsNullOrEmpty(v.Identifier.Text) && v.Initializer != null)
                    {
                        Error(v, "unsupported variable designation");
                        continue;
                    }

                    _locals.Add(v.Identifier.Text);
                    _locals.Add(name);
                    if (IsIntegerType(local.Declaration.Type))
                    {
                        _intNames.Add(v.Identifier.Text);
                        _intNames.Add(name);
                    }
                    EmitLine($"{kw} {name}{init};");
                }
                break;

            case ReturnStatementSyntax ret:
                if (ret.Expression != null)
                    EmitLine($"return {Expr(ret.Expression)};");
                else
                    EmitLine("return;");
                break;

            case ExpressionStatementSyntax es:
                if (es.Expression is AssignmentExpressionSyntax
                    {
                        Left: DeclarationExpressionSyntax or TupleExpressionSyntax,
                    } decon)
                {
                    TranslateDeconstruction(decon);
                    break;
                }

                EmitLine($"{Expr(es.Expression)};");
                break;

            case IfStatementSyntax ifs:
                EmitPatternBindings(ifs.Condition);
                EmitLine($"if ({Expr(ifs.Condition)}) {{");
                Indent();
                TranslateEmbedded(ifs.Statement);
                Dedent();
                EmitLine("}");
                if (ifs.Else != null)
                {
                    EmitLine("else {");
                    Indent();
                    TranslateEmbedded(ifs.Else.Statement);
                    Dedent();
                    EmitLine("}");
                }
                break;

            case WhileStatementSyntax ws:
                EmitPatternBindings(ws.Condition);
                EmitLine($"while ({Expr(ws.Condition)}) {{");
                Indent();
                PushPatternScope();
                // re-bind patterns each iteration for is-patterns in condition
                EmitPatternBindings(ws.Condition, rebind: true);
                TranslateEmbedded(ws.Statement);
                PopPatternScope();
                Dedent();
                EmitLine("}");
                break;

            case ForEachStatementSyntax fe:
                if (fe.Type is NullableTypeSyntax)
                    _nullableValueLocals.Add(fe.Identifier.Text);
                EmitLine($"for (const {fe.Identifier.Text} of {Expr(fe.Expression)}) {{");
                Indent();
                PushPatternScope();
                TranslateEmbedded(fe.Statement);
                PopPatternScope();
                Dedent();
                EmitLine("}");
                break;

            case ForStatementSyntax fs:
                TranslateFor(fs);
                break;

            case SwitchStatementSyntax sw:
                EmitLine($"switch ({Expr(sw.Expression)}) {{");
                Indent();
                foreach (var section in sw.Sections)
                {
                    foreach (var label in section.Labels)
                    {
                        if (label is CaseSwitchLabelSyntax c)
                            EmitLine($"case {Expr(c.Value)}:");
                        else if (label is DefaultSwitchLabelSyntax)
                            EmitLine("default:");
                        else
                            Error(label, $"unsupported switch label {label.Kind()}");
                    }

                    Indent();
                    foreach (var s in section.Statements)
                        TranslateStatement(s);
                    Dedent();
                }

                Dedent();
                EmitLine("}");
                break;

            case BlockSyntax block:
                foreach (var s in block.Statements)
                    TranslateStatement(s);
                break;

            case BreakStatementSyntax:
                EmitLine("break;");
                break;

            case ContinueStatementSyntax:
                EmitLine("continue;");
                break;

            case YieldStatementSyntax ys:
                if (ys.ReturnOrBreakKeyword.IsKind(SyntaxKind.BreakKeyword))
                {
                    EmitLine("return __yield;");
                }
                else if (ys.Expression != null)
                {
                    EmitLine($"__yield.push({Expr(ys.Expression)});");
                }
                break;

            case ThrowStatementSyntax th:
                if (th.Expression is ObjectCreationExpressionSyntax oc)
                {
                    var parts = oc.ArgumentList?.Arguments.Select(a => Expr(a.Expression)).ToList()
                                ?? new List<string>();
                    var msg = parts.Count == 0
                        ? "\"error\""
                        : parts.Count == 1
                            ? $"String({parts[0]})"
                            : $"[{string.Join(", ", parts)}].join(\": \")";
                    EmitLine($"throw new Error({msg});");
                }
                else
                {
                    EmitLine(th.Expression != null
                        ? $"throw {Expr(th.Expression)};"
                        : "throw new Error();");
                }
                break;

            default:
                Error(stmt, $"Unsupported statement: {stmt.Kind()}");
                break;
        }
    }

    private void TranslateFor(ForStatementSyntax fs)
    {
        // Special-case: condition contains `is Type name` pattern (ChordUtils chordRunNerf)
        if (fs.Condition != null && ContainsIsPattern(fs.Condition))
        {
            // Emit init
            if (fs.Declaration != null)
            {
                foreach (var v in fs.Declaration.Variables)
                {
                    var init = v.Initializer != null ? $" = {Expr(v.Initializer.Value)}" : "";
                    EmitLine($"let {v.Identifier.Text}{init};");
                }
            }
            else
            {
                foreach (var i in fs.Initializers)
                    EmitLine($"{Expr(i)};");
            }

            EmitLine("for (;;) {");
            Indent();
            PushPatternScope();
            // Extract non-pattern parts and pattern bindings
            EmitPatternBindings(fs.Condition);
            EmitLine($"if (!({Expr(fs.Condition)})) break;");
            TranslateEmbedded(fs.Statement);
            foreach (var inc in fs.Incrementors)
                EmitLine($"{ForIncrement(inc)};");
            PopPatternScope();
            Dedent();
            EmitLine("}");
            return;
        }

        string inits;
        if (fs.Declaration != null)
        {
            var typeStr = fs.Declaration.Type.ToString();
            var typeAnn = typeStr.Contains('?')
                ? $": {MapType(fs.Declaration.Type)} | null"
                : "";

            inits = string.Join(", ", fs.Declaration.Variables.Select(v =>
            {
                var name = SafeName(v.Identifier.Text);
                _locals.Add(v.Identifier.Text);
                _locals.Add(name);
                return v.Initializer != null
                    ? $"{name}{typeAnn} = {Expr(v.Initializer.Value)}"
                    : $"{name}{typeAnn}";
            }));
        }
        else
        {
            inits = string.Join(", ", fs.Initializers.Select(Expr));
        }

        var cond = fs.Condition != null ? Expr(fs.Condition) : "true";
        var incStr = string.Join(", ", fs.Incrementors.Select(ForIncrement));
        EmitLine($"for (let {inits}; {cond}; {incStr}) {{");
        Indent();
        PushPatternScope();
        TranslateEmbedded(fs.Statement);
        PopPatternScope();
        Dedent();
        EmitLine("}");
    }

    /// <summary>
    /// A <c>var</c> loop variable keeps the initializer's non-null type, while the
    /// step often assigns a nullable walk (<c>PrevInColumn</c>). The assertion is
    /// erased, so a null step still fails the loop condition.
    /// </summary>
    private string ForIncrement(ExpressionSyntax inc)
    {
        if (inc is AssignmentExpressionSyntax
            {
                RawKind: (int)SyntaxKind.SimpleAssignmentExpression,
            } assign)
        {
            var left = Expr(assign.Left);
            return $"{left} = {Expr(assign.Right)} as typeof {left}";
        }

        return Expr(inc);
    }

    private void PushPatternScope() =>
        _patternScopes.Push(new HashSet<string>(StringComparer.Ordinal));

    private void PopPatternScope() => _patternScopes.Pop();

    private bool PatternNameInCurrentScope(string name) =>
        _patternScopes.Count > 0 && _patternScopes.Peek().Contains(name);

    private static bool ContainsIsPattern(ExpressionSyntax expr) =>
        expr.DescendantNodesAndSelf().Any(n => n is IsPatternExpressionSyntax);

    /// <summary>
    /// Hoist `expr is Type name` / `expr is not Type name` into const bindings before a condition.
    /// </summary>
    private void EmitPatternBindings(ExpressionSyntax condition, bool rebind = false)
    {
        var boundThisPass = new HashSet<string>(StringComparer.Ordinal);
        foreach (var isPat in condition.DescendantNodesAndSelf().OfType<IsPatternExpressionSyntax>())
        {
            if (!TryPatternDesignation(isPat.Pattern, out var designation))
                continue;

            var name = SafeName(designation);
            // A name bound in a finished sibling block (another loop) must be
            // declared again. Skipping it reuses a binding that is out of scope.
            if (!rebind && PatternNameInCurrentScope(name))
                continue;

            var rhs = Expr(isPat.Expression);
            var deps = isPat.Expression.DescendantNodesAndSelf()
                .OfType<IdentifierNameSyntax>()
                .Select(id => id.Identifier.Text)
                .Where(boundThisPass.Contains)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var assign = rebind && _boundPatternNames.Contains(name) ? "" : "const ";
            if (deps.Count == 0)
                EmitLine($"{assign}{name} = {rhs};");
            else
            {
                // A later pattern may read an earlier binding (`a is { } x || Foo(x.Index) is { } y`).
                // C# does not evaluate the right side when the left binding is null.
                var guard = string.Join(" && ", deps.Select(d => $"{SafeName(d)} != null"));
                EmitLine($"{assign}{name} = {guard} ? {rhs} : null;");
            }

            boundThisPass.Add(designation);
            boundThisPass.Add(name);
            _boundPatternNames.Add(name);
            _boundPatternNames.Add(designation);
            if (_patternScopes.Count > 0)
            {
                _patternScopes.Peek().Add(name);
                _patternScopes.Peek().Add(designation);
            }
            _locals.Add(name);
            _locals.Add(designation);
        }
    }

    private static bool TryPatternDesignation(PatternSyntax pattern, out string name)
    {
        name = "";
        switch (pattern)
        {
            case DeclarationPatternSyntax { Designation: SingleVariableDesignationSyntax svd }:
                name = svd.Identifier.Text;
                return true;
            case RecursivePatternSyntax { Designation: SingleVariableDesignationSyntax svd3 }:
                name = svd3.Identifier.Text;
                return true;
            case UnaryPatternSyntax { Pattern: DeclarationPatternSyntax { Designation: SingleVariableDesignationSyntax svd2 } }:
                name = svd2.Identifier.Text;
                return true;
            case UnaryPatternSyntax
            {
                Pattern: RecursivePatternSyntax { Designation: SingleVariableDesignationSyntax svd4 },
            }:
                name = svd4.Identifier.Text;
                return true;
            default:
                return false;
        }
    }

    private void TranslateDeconstruction(AssignmentExpressionSyntax assign)
    {
        EmitPatternBindings(assign.Right);
        var tmp = "__decon";
        EmitLine($"const {tmp} = {Expr(assign.Right)};");

        var names = new List<string>();
        if (assign.Left is DeclarationExpressionSyntax decl &&
            decl.Designation is ParenthesizedVariableDesignationSyntax pvd)
        {
            foreach (var d in pvd.Variables)
            {
                if (d is SingleVariableDesignationSyntax s)
                    names.Add(SafeName(s.Identifier.Text));
                else
                    Error(d, "nested deconstruction not supported");
            }
        }
        else if (assign.Left is TupleExpressionSyntax te)
        {
            foreach (var arg in te.Arguments)
            {
                if (arg.Expression is DeclarationExpressionSyntax de &&
                    de.Designation is SingleVariableDesignationSyntax s)
                    names.Add(SafeName(s.Identifier.Text));
                else if (arg.Expression is IdentifierNameSyntax id)
                    names.Add(SafeName(id.Identifier.Text));
                else
                    Error(arg, "unsupported deconstruction element");
            }
        }

        // Emit as named fields matching deconstruction names (tuple returns use same names when possible)
        for (var i = 0; i < names.Count; i++)
        {
            var n = names[i];
            _locals.Add(n);
            // Prefer property named after binding, then positional itemN, then index
            EmitLine($"const {n} = ({tmp} as any).{n};");
        }
    }

    private List<string>? TupleElementNames(TypeSyntax? type)
    {
        if (type is not TupleTypeSyntax tt) return null;
        var names = new List<string>();
        var i = 0;
        foreach (var el in tt.Elements)
        {
            var n = el.Identifier.Text;
            names.Add(string.IsNullOrEmpty(n) ? $"item{i + 1}" : n);
            i++;
        }

        return names;
    }

    private void TranslateEmbedded(StatementSyntax stmt)
    {
        if (stmt is BlockSyntax block)
        {
            foreach (var s in block.Statements)
                TranslateStatement(s);
        }
        else
        {
            TranslateStatement(stmt);
        }
    }

    private string Expr(ExpressionSyntax expr)
    {
        switch (expr)
        {
            case LiteralExpressionSyntax lit:
            {
                var t = lit.Token.Text;
                // Strip C# numeric suffixes: 1e-6D, 1.0f, 1L, 1M
                if (lit.IsKind(SyntaxKind.NumericLiteralExpression) && t.Length > 0)
                {
                    var last = t[^1];
                    if (last is 'D' or 'd' or 'F' or 'f' or 'M' or 'm' or 'L' or 'l' or 'U' or 'u')
                        t = t[..^1];
                    if (t.Length > 0 && t[^1] is 'U' or 'u' or 'L' or 'l')
                        t = t[..^1];
                }

                return t;
            }

            case TupleExpressionSyntax tuple:
            {
                var names = _currentMethod != null
                    ? TupleElementNames(_currentMethod.ReturnType)
                    : null;
                var parts = new List<string>();
                for (var i = 0; i < tuple.Arguments.Count; i++)
                {
                    var arg = tuple.Arguments[i];
                    var val = Expr(arg.Expression);
                    var key = arg.NameColon?.Name.Identifier.Text
                              ?? (names != null && i < names.Count ? names[i] : $"item{i + 1}");
                    parts.Add($"{key}: {val}");
                }

                return $"{{ {string.Join(", ", parts)} }}";
            }

            case IdentifierNameSyntax id:
            {
                var name = id.Identifier.Text;
                if (_locals.Contains(name) || _boundPatternNames.Contains(name))
                    return SafeName(name);
                NoteIdentifier(name);
                return MapIdentifier(name);
            }

            case MemberAccessExpressionSyntax ma:
            {
                var leftName = TypeOrIdentifierName(ma.Expression);
                if (leftName == "Math")
                {
                    var n = ma.Name.Identifier.Text;
                    if (n is "E" or "PI")
                        return $"Math.{n}";
                }

                if (leftName is "double" or "Double" or "float" or "Float" or "single" or "Single")
                {
                    return ma.Name.Identifier.Text switch
                    {
                        "NaN" => "Number.NaN",
                        "PositiveInfinity" => "Number.POSITIVE_INFINITY",
                        "NegativeInfinity" => "Number.NEGATIVE_INFINITY",
                        _ => $"Number.{ma.Name.Identifier.Text}",
                    };
                }

                // Static field on current type referenced as bare name already handled;
                // ClassName.Member
                if (leftName != null && GeneratedModules.ContainsKey(leftName))
                {
                    EnsureImport(leftName);
                    return $"{leftName}.{ma.Name.Identifier.Text}";
                }

                if (leftName == _typeName)
                    return $"{_typeName}.{ma.Name.Identifier.Text}";

                var member = ma.Name.Identifier.Text;
                // Nullable<T>.Value unwraps to the value. Only locals declared as T? are tracked.
                if (member == "Value" &&
                    ma.Expression is IdentifierNameSyntax valueId &&
                    _nullableValueLocals.Contains(valueId.Identifier.Text))
                    return SafeName(valueId.Identifier.Text);
                // C# array.Length → JS array.length
                if (member == "Length")
                    member = "length";
                return $"{Expr(ma.Expression)}.{member}";
            }

            case BinaryExpressionSyntax bin:
            {
                // C# integer division truncates. JS `/` is always floating point.
                if (bin.OperatorToken.IsKind(SyntaxKind.SlashToken) &&
                    IsIntExpr(bin.Left) && IsIntExpr(bin.Right))
                    return $"(Math.trunc({Expr(bin.Left)} / {Expr(bin.Right)}))";

                // `a is T x && x.Y` — left may be is-pattern; bindings hoisted by statement
                return $"({Expr(bin.Left)} {bin.OperatorToken.Text} {Expr(bin.Right)})";
            }

            case PrefixUnaryExpressionSyntax pre:
                return $"({pre.OperatorToken.Text}{Expr(pre.Operand)})";

            case PostfixUnaryExpressionSyntax post:
                return $"({Expr(post.Operand)}{post.OperatorToken.Text})";

            case ParenthesizedExpressionSyntax par:
                return $"({Expr(par.Expression)})";

            case ConditionalExpressionSyntax cond:
                return $"({Expr(cond.Condition)} ? {Expr(cond.WhenTrue)} : {Expr(cond.WhenFalse)})";

            case AssignmentExpressionSyntax assign:
                return $"{Expr(assign.Left)} {assign.OperatorToken.Text} {Expr(assign.Right)}";

            case InvocationExpressionSyntax inv:
                return TranslateInvocation(inv);

            case ConditionalAccessExpressionSyntax ca:
                return TranslateConditionalAccess(ca);

            case ElementAccessExpressionSyntax ea:
            {
                var args = string.Join(", ", ea.ArgumentList.Arguments.Select(a => Expr(a.Expression)));
                return $"{Expr(ea.Expression)}[{args}]";
            }

            case ObjectCreationExpressionSyntax oc:
                return TranslateObjectCreation(oc);

            case ArrayCreationExpressionSyntax ac:
                if (ac.Initializer != null)
                    return $"[ {string.Join(", ", ac.Initializer.Expressions.Select(Expr))} ]";
                if (ac.Type.RankSpecifiers.Count > 0 &&
                    ac.Type.RankSpecifiers[0].Sizes.Count == 1 &&
                    ac.Type.RankSpecifiers[0].Sizes[0] is ExpressionSyntax sizeExpr)
                {
                    return $"Array.from({{ length: {Expr(sizeExpr)} }}, () => 0)";
                }

                return "[]";

            case ImplicitArrayCreationExpressionSyntax iac:
                return $"[ {string.Join(", ", iac.Initializer.Expressions.Select(Expr))} ]";

            case InitializerExpressionSyntax init
                when init.IsKind(SyntaxKind.ArrayInitializerExpression) ||
                     init.IsKind(SyntaxKind.ComplexElementInitializerExpression) ||
                     init.IsKind(SyntaxKind.CollectionInitializerExpression) ||
                     init.IsKind(SyntaxKind.ObjectInitializerExpression):
                // Field init: double[][] x = { new[] { 1 }, new[] { 2 } };
                return $"[ {string.Join(", ", init.Expressions.Select(Expr))} ]";

            case CastExpressionSyntax cast:
            {
                var target = StripNullable(cast.Type.ToString());
                var simple = target.Contains('.') ? target[(target.LastIndexOf('.') + 1)..] : target;
                if (simple is "int" or "long" or "short" or "byte" or "uint" or "ulong")
                    return $"Math.trunc({Expr(cast.Expression)})";
                if (simple is "double" or "float" or "single" or "decimal")
                    return $"Number({Expr(cast.Expression)})";
                // Reference / domain casts are no-ops in TS
                return Expr(cast.Expression);
            }

            case ThisExpressionSyntax:
                return "this";

            case SwitchExpressionSyntax se:
                return TranslateSwitchExpression(se);

            case CheckedExpressionSyntax ch:
                return Expr(ch.Expression);

            case DefaultExpressionSyntax:
                return "undefined";

            case IsPatternExpressionSyntax isPat:
                return TranslateIsPattern(isPat);

            case DeclarationExpressionSyntax:
                Error(expr, "declaration expression not supported here");
                return "undefined";

            case SimpleLambdaExpressionSyntax lam:
            {
                var p = lam.Parameter.Identifier.Text;
                if (lam.Body is not ExpressionSyntax body)
                {
                    Error(lam, "block lambdas not supported");
                    return "(() => undefined)";
                }

                return $"(({p}: any) => {Expr(body)})";
            }

            case ParenthesizedLambdaExpressionSyntax plam:
            {
                if (plam.Body is not ExpressionSyntax body)
                {
                    Error(plam, "block lambdas not supported");
                    return "(() => undefined)";
                }

                var ps = string.Join(", ", plam.ParameterList.Parameters.Select(p =>
                    $"{p.Identifier.Text}: {MapType(p.Type)}"));
                return $"(({ps}) => {Expr(body)})";
            }

            case InterpolatedStringExpressionSyntax:
                Error(expr, "interpolated strings not supported");
                return "\"\"";

            case RefExpressionSyntax:
                Error(expr, "ref expression not supported");
                return "undefined";

            case RangeExpressionSyntax:
                Error(expr, "range expression not supported");
                return "undefined";

            default:
                Error(expr, $"Unsupported expression: {expr.Kind()}");
                return "undefined";
        }
    }

    private string TranslateIsPattern(IsPatternExpressionSyntax isPat)
    {
        // After EmitPatternBindings, declaration patterns bind names; condition uses null checks.
        if (isPat.Pattern is DeclarationPatternSyntax decl &&
            decl.Designation is SingleVariableDesignationSyntax svd)
        {
            return $"({SafeName(svd.Identifier.Text)} != null)";
        }

        if (isPat.Pattern is UnaryPatternSyntax
            {
                OperatorToken.RawKind: (int)SyntaxKind.NotKeyword,
                Pattern: DeclarationPatternSyntax decl2,
            } && decl2.Designation is SingleVariableDesignationSyntax svd2)
        {
            return $"({SafeName(svd2.Identifier.Text)} == null)";
        }

        // `x is not HoldNote` / `x is HoldNote` / `x is not T`
        // Note: Roslyn often represents `is not TypeName` as NotPattern + ConstantPattern(Identifier).
        if (isPat.Pattern is UnaryPatternSyntax
            {
                OperatorToken.RawKind: (int)SyntaxKind.NotKeyword,
            } notPat)
        {
            if (TryTypeNameFromPattern(notPat.Pattern, out var notTypeName))
                return TranslateTypeNameTest(isPat.Expression, notTypeName, negate: true);
            if (notPat.Pattern is TypePatternSyntax notType)
                return TranslateTypeTest(isPat.Expression, notType.Type, negate: true);
            if (notPat.Pattern is DeclarationPatternSyntax { Designation: null } dpNull)
                return TranslateTypeTest(isPat.Expression, dpNull.Type, negate: true);
            if (notPat.Pattern is DeclarationPatternSyntax
                {
                    Designation: SingleVariableDesignationSyntax svdNot,
                })
                return $"({SafeName(svdNot.Identifier.Text)} == null)";
            if (notPat.Pattern is RecursivePatternSyntax recN)
            {
                if (recN.Designation is SingleVariableDesignationSyntax svdN)
                    return $"({SafeName(svdN.Identifier.Text)} == null)";
                return $"({Expr(isPat.Expression)} == null)";
            }

            if (notPat.Pattern is ConstantPatternSyntax notConst &&
                notConst.Expression.IsKind(SyntaxKind.NullLiteralExpression))
                return $"({Expr(isPat.Expression)} != null)";

            return $"({Expr(isPat.Expression)} == null)";
        }

        if (TryTypeNameFromPattern(isPat.Pattern, out var typeName))
            return TranslateTypeNameTest(isPat.Expression, typeName, negate: false);

        if (isPat.Pattern is TypePatternSyntax typePat)
            return TranslateTypeTest(isPat.Expression, typePat.Type, negate: false);

        if (isPat.Pattern is DeclarationPatternSyntax { Designation: null } dpOnly)
            return TranslateTypeTest(isPat.Expression, dpOnly.Type, negate: false);

        // `x is { }` / `x is not { }` / `x is { } name`
        if (isPat.Pattern is RecursivePatternSyntax rec)
        {
            if (rec.Designation is SingleVariableDesignationSyntax svd3)
                return $"({SafeName(svd3.Identifier.Text)} != null)";
            return $"({Expr(isPat.Expression)} != null)";
        }

        if (isPat.Pattern is UnaryPatternSyntax
            {
                OperatorToken.RawKind: (int)SyntaxKind.NotKeyword,
                Pattern: RecursivePatternSyntax recNot,
            })
        {
            if (recNot.Designation is SingleVariableDesignationSyntax svd4)
                return $"({SafeName(svd4.Identifier.Text)} == null)";
            return $"({Expr(isPat.Expression)} == null)";
        }

        if (isPat.Pattern is ConstantPatternSyntax cp)
            return $"({Expr(isPat.Expression)} === {Expr(cp.Expression)})";

        if (isPat.Pattern is DiscardPatternSyntax)
            return "true";

        Error(isPat, $"unsupported is-pattern {isPat.Pattern.Kind()}");
        return "false";
    }

    private static bool TryTypeNameFromPattern(PatternSyntax pattern, out string name)
    {
        name = "";
        if (pattern is ConstantPatternSyntax cp)
        {
            if (cp.Expression is IdentifierNameSyntax id)
            {
                name = id.Identifier.Text;
                return true;
            }

            if (cp.Expression is MemberAccessExpressionSyntax ma)
            {
                name = ma.Name.Identifier.Text;
                return true;
            }
        }

        if (pattern is TypePatternSyntax tp)
        {
            name = StripNullable(tp.Type.ToString());
            if (name.Contains('.'))
                name = name[(name.LastIndexOf('.') + 1)..];
            return true;
        }

        return false;
    }

    private string TranslateTypeTest(ExpressionSyntax expr, TypeSyntax type, bool negate)
    {
        var t = StripNullable(type.ToString());
        var simple = t.Contains('.') ? t[(t.LastIndexOf('.') + 1)..] : t;
        return TranslateTypeNameTest(expr, simple, negate);
    }

    private string TranslateTypeNameTest(ExpressionSyntax expr, string simple, bool negate)
    {
        var target = Expr(expr);

        // Domain: HoldNote / Note live on adapter as IsHoldNote
        // current.BaseObject is HoldNote → current.IsHoldNote
        string test;
        if (simple is "HoldNote" or "Note")
        {
            var holdTarget = target.EndsWith(".BaseObject", StringComparison.Ordinal)
                ? target[..^".BaseObject".Length]
                : target;
            test = simple == "HoldNote"
                ? $"!!({holdTarget}).IsHoldNote"
                : $"!({holdTarget}).IsHoldNote";
        }
        else
        {
            test = $"(({target}) != null)";
        }

        return negate ? $"!({test})" : test;
    }

    private string TranslateObjectCreation(ObjectCreationExpressionSyntax oc)
    {
        var typeName = oc.Type.ToString();
        if (typeName.Contains("List<", StringComparison.Ordinal) ||
            typeName.StartsWith("List<", StringComparison.Ordinal))
        {
            if (oc.Initializer != null)
                return $"[ {string.Join(", ", oc.Initializer.Expressions.Select(Expr))} ]";
            return "[]";
        }

        if (typeName.Contains("Exception", StringComparison.Ordinal))
        {
            var args = oc.ArgumentList?.Arguments.Select(a => Expr(a.Expression)) ?? Array.Empty<string>();
            return $"new Error(String({string.Join(", ", args)}))";
        }

            // new double[n]
        if (oc.Type is ArrayTypeSyntax at && at.RankSpecifiers.Count > 0)
        {
            var size = at.RankSpecifiers[0].Sizes.Count > 0
                ? Expr(at.RankSpecifiers[0].Sizes[0])
                : "0";
            return $"Array.from({{ length: {size} }}, () => 0)";
        }

        Error(oc, $"Unsupported object creation: {typeName}");
        return "null";
    }

    private string TranslateSwitchExpression(SwitchExpressionSyntax se)
    {
        var sb = new StringBuilder();
        sb.Append("(() => { const __v = ");
        sb.Append(Expr(se.GoverningExpression));
        sb.Append("; switch (__v) {");
        foreach (var arm in se.Arms)
        {
            if (arm.Pattern is ConstantPatternSyntax cp)
            {
                sb.Append(" case ");
                sb.Append(Expr(cp.Expression));
                sb.Append(": return ");
                sb.Append(Expr(arm.Expression));
                sb.Append(';');
            }
            else if (arm.Pattern is DiscardPatternSyntax)
            {
                sb.Append(" default: return ");
                sb.Append(Expr(arm.Expression));
                sb.Append(';');
            }
            else
            {
                Error(arm, $"unsupported switch arm pattern {arm.Pattern.Kind()}");
            }
        }

        sb.Append(" } })()");
        return sb.ToString();
    }

    private string TranslateConditionalAccess(ConditionalAccessExpressionSyntax ca)
    {
        var left = Expr(ca.Expression);
        switch (ca.WhenNotNull)
        {
            case MemberBindingExpressionSyntax mb:
            {
                var member = mb.Name.Identifier.Text;
                if (member == "Length")
                    member = "length";
                return $"({left}?.{member} ?? null)";
            }
            case InvocationExpressionSyntax inv when inv.Expression is MemberBindingExpressionSyntax imb:
            {
                var args = string.Join(", ", inv.ArgumentList.Arguments.Select(a => Expr(a.Expression)));
                return $"({left}?.{imb.Name.Identifier.Text}({args}) ?? null)";
            }
            default:
                Error(ca, $"unsupported conditional access {ca.WhenNotNull.Kind()}");
                return "null";
        }
    }

    private string TranslateInvocation(InvocationExpressionSyntax inv)
    {
        foreach (var a in inv.ArgumentList.Arguments)
        {
            if (a.RefKindKeyword.IsKind(SyntaxKind.OutKeyword) ||
                a.RefKindKeyword.IsKind(SyntaxKind.RefKeyword))
            {
                Error(a, "ref/out arguments not supported");
                return "undefined";
            }
        }

        var argList = string.Join(", ", inv.ArgumentList.Arguments.Select(a => Expr(a.Expression)));

        if (inv.Expression is MemberAccessExpressionSyntax ma)
        {
            var leftName = TypeOrIdentifierName(ma.Expression);
            var method = ma.Name.Identifier.Text;

            if (leftName == "Math")
            {
                if (method == "Clamp" && inv.ArgumentList.Arguments.Count == 3)
                {
                    var a0 = Expr(inv.ArgumentList.Arguments[0].Expression);
                    var a1 = Expr(inv.ArgumentList.Arguments[1].Expression);
                    var a2 = Expr(inv.ArgumentList.Arguments[2].Expression);
                    return $"Math.min(Math.max({a0}, {a1}), {a2})";
                }

                return $"Math.{MapMathMethod(method)}({argList})";
            }

            // System.Array.Sort / Reverse (in-place)
            if (leftName is "Array" or "System.Array")
            {
                if (method == "Sort" && inv.ArgumentList.Arguments.Count >= 1)
                {
                    var arr = Expr(inv.ArgumentList.Arguments[0].Expression);
                    return $"{arr}.sort((a: number, b: number) => a - b)";
                }

                if (method == "Reverse" && inv.ArgumentList.Arguments.Count >= 1)
                {
                    var arr = Expr(inv.ArgumentList.Arguments[0].Expression);
                    return $"{arr}.reverse()";
                }

                if (method == "IndexOf" && inv.ArgumentList.Arguments.Count >= 2)
                {
                    var arr = Expr(inv.ArgumentList.Arguments[0].Expression);
                    var item = Expr(inv.ArgumentList.Arguments[1].Expression);
                    return $"{arr}.indexOf({item})";
                }
            }

            if (leftName is "double" or "Double" or "float" or "Float" or "single" or "Single")
            {
                return method switch
                {
                        "IsNaN" => $"Number.isNaN({argList})",
                        "IsPositiveInfinity" => $"(({argList}) === Number.POSITIVE_INFINITY)",
                        "IsNegativeInfinity" => $"(({argList}) === Number.NEGATIVE_INFINITY)",
                        "IsInfinity" => $"(!Number.isFinite({argList}) && !Number.isNaN({argList}))",
                        "IsFinite" => $"Number.isFinite({argList})",
                        _ => $"Number.{method}({argList})",
                    };
                }

            if (leftName != null && GeneratedModules.ContainsKey(leftName))
            {
                EnsureImport(leftName);
                return $"{leftName}.{method}({argList})";
            }

            if (leftName == _typeName)
                return $"{_typeName}.{method}({argList})";

            if (method is "Select" or "Where" or "Count" or "Any")
            {
                var recv = Expr(ma.Expression);
                if (method == "Select" && inv.ArgumentList.Arguments.Count == 1)
                    return $"{recv}.map({Expr(inv.ArgumentList.Arguments[0].Expression)})";
                if (method == "Where" && inv.ArgumentList.Arguments.Count == 1)
                    return $"{recv}.filter({Expr(inv.ArgumentList.Arguments[0].Expression)})";
                if (method == "Count" && inv.ArgumentList.Arguments.Count == 0)
                    return $"{recv}.length";
                if (method == "Count" && inv.ArgumentList.Arguments.Count == 1)
                    return $"{recv}.filter({Expr(inv.ArgumentList.Arguments[0].Expression)}).length";
                if (method == "Any" && inv.ArgumentList.Arguments.Count == 0)
                    return $"({recv}.length > 0)";
                if (method == "Any" && inv.ArgumentList.Arguments.Count == 1)
                    return $"{recv}.some({Expr(inv.ArgumentList.Arguments[0].Expression)})";
            }

            // instance method
            return $"{Expr(ma.Expression)}.{method}({argList})";
        }

        if (inv.Expression is IdentifierNameSyntax id)
        {
            // nameof(x)
            if (id.Identifier.Text == "nameof" && inv.ArgumentList.Arguments.Count == 1)
            {
                var arg = inv.ArgumentList.Arguments[0].Expression;
                if (arg is IdentifierNameSyntax nid)
                    return $"\"{nid.Identifier.Text}\"";
                if (arg is MemberAccessExpressionSyntax nma)
                    return $"\"{nma.Name.Identifier.Text}\"";
                return $"\"{arg}\"";
            }

            // Parameter/local callable (e.g. Func<> named function_)
            if (_locals.Contains(id.Identifier.Text) || _boundPatternNames.Contains(id.Identifier.Text))
                return $"{SafeName(id.Identifier.Text)}({argList})";

            // Same-class static call
            return $"{_typeName}.{id.Identifier.Text}({argList})";
        }

        return $"{Expr(inv.Expression)}({argList})";
    }

    private void NoteIdentifier(string name)
    {
        if (GeneratedModules.ContainsKey(name) && name != _typeName)
            EnsureImport(name);
        if (ShimModules.ContainsKey(name))
            EnsureShimImport(name);
    }

    private void NoteTypeUsage(TypeSyntax? type)
    {
        if (type == null) return;
        var t = StripNullable(type.ToString());
        // Func<double, double>
        if (t.StartsWith("Func<", StringComparison.Ordinal))
            return;
        var simple = t.Contains('.') ? t[(t.LastIndexOf('.') + 1)..] : t;
        simple = simple.Replace("[]", "");
        if (GeneratedModules.ContainsKey(simple) && simple != _typeName)
            EnsureImport(simple);
        if (ShimModules.ContainsKey(simple))
            EnsureShimImport(simple);
    }

    private void EnsureImport(string typeName)
    {
        if (typeName == _typeName) return;
        if (!GeneratedModules.TryGetValue(typeName, out var module))
            return;
        var rel = RelativeImport(_outRel, module + ".ts");
        // Named import of const export
        _imports.Add($"import {{ {typeName} }} from \"{rel}\";");
    }

    private void EnsureShimImport(string typeName)
    {
        if (!ShimModules.TryGetValue(typeName, out var module))
            return;
        var rel = RelativeImport(_outRel, module + ".ts", fromGeneratedToSrc: true);
        _imports.Add($"import type {{ {typeName} }} from \"{rel}\";");
    }

    private static string RelativeImport(string fromFile, string toFile, bool fromGeneratedToSrc = false)
    {
        // fromFile e.g. osu.Game.Rulesets.Mania/Difficulty/Utils/X.ts under generated/
        // toFile either generated-relative or src/...
        var fromDir = Path.GetDirectoryName(fromFile)!.Replace('\\', '/');
        string toPath;
        if (fromGeneratedToSrc)
        {
            // generated/A/B/C.ts → src/adapters/hitObject.ts
            // depth = parts of fromDir + 1 for generated
            var depth = fromDir.Split('/', StringSplitOptions.RemoveEmptyEntries).Length + 1;
            var prefix = string.Join("/", Enumerable.Repeat("..", depth));
            toPath = prefix + "/" + toFile.Replace('\\', '/');
            if (toPath.EndsWith(".ts")) toPath = toPath[..^3];
            return toPath.StartsWith('.') ? toPath : "./" + toPath;
        }

        toPath = toFile.Replace('\\', '/');
        if (toPath.EndsWith(".ts")) toPath = toPath[..^3];

        var fromParts = fromDir.Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
        var toParts = toPath.Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
        // toParts includes filename as last
        var toDir = toParts.Take(toParts.Count - 1).ToList();
        var toName = toParts[^1];

        var i = 0;
        while (i < fromParts.Count && i < toDir.Count && fromParts[i] == toDir[i])
            i++;

        var ups = fromParts.Count - i;
        var relParts = Enumerable.Repeat("..", ups).Concat(toDir.Skip(i)).Append(toName).ToList();
        if (relParts.Count == 1)
            return "./" + relParts[0];
        var rel = string.Join("/", relParts);
        return rel.StartsWith('.') ? rel : "./" + rel;
    }

    private static string? TypeOrIdentifierName(ExpressionSyntax expr) => expr switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        PredefinedTypeSyntax pt => pt.Keyword.Text,
        _ => null,
    };

    private static string MapMathMethod(string name) => name switch
    {
        "Abs" => "abs",
        "Exp" => "exp",
        "Log" => "log",
        "Sqrt" => "sqrt",
        "Pow" => "pow",
        "Sign" => "sign",
        "Min" => "min",
        "Max" => "max",
        "Floor" => "floor",
        "Ceiling" => "ceil",
        "Round" => "round",
        "Truncate" => "trunc",
        "Cos" => "cos",
        "Sin" => "sin",
        "Tan" => "tan",
        "Acos" => "acos",
        "Asin" => "asin",
        "Atan" => "atan",
        "Atan2" => "atan2",
        _ => name.Length > 0 ? char.ToLowerInvariant(name[0]) + name[1..] : name,
    };

    private static string MapIdentifier(string name) => name switch
    {
        "true" => "true",
        "false" => "false",
        "null" => "null",
        _ => name,
    };

    private string MapType(TypeSyntax? type)
    {
        if (type == null) return "void";
        if (type is TupleTypeSyntax tt)
            return MapTupleType(tt);
        if (type is NullableTypeSyntax nt)
            return MapType(nt.ElementType);

        var t = StripNullable(type.ToString().Trim());

        if (t.StartsWith("Func<", StringComparison.Ordinal))
            return "(x: number) => number";

        var simple = t.Contains('.') ? t[(t.LastIndexOf('.') + 1)..] : t;

        if (simple.EndsWith("[]", StringComparison.Ordinal))
        {
            var inner = simple[..^2];
            return inner switch
            {
                "double" or "float" or "int" or "long" => "number[]",
                _ when ShimModules.ContainsKey(inner) => $"{inner}[]",
                _ => "unknown[]",
            };
        }

        return simple switch
        {
            "void" => "void",
            "double" or "float" or "single" or "int" or "long" or "short" or "byte" or "uint" or "decimal" => "number",
            "bool" or "boolean" => "boolean",
            "string" or "String" => "string",
            "object" or "Object" => "unknown",
            _ when ShimModules.ContainsKey(simple) => simple,
            _ when GeneratedModules.ContainsKey(simple) => "typeof " + simple,
            _ when simple.StartsWith("List<", StringComparison.Ordinal) => "number[]",
            _ when simple.StartsWith("IEnumerable<", StringComparison.Ordinal) => "number[]",
            _ => "unknown",
        };
    }

    // Tuple types: (int a, double b) → { a: number, b: number }
    private string MapTupleType(TupleTypeSyntax tt)
    {
        var parts = new List<string>();
        var i = 0;
        foreach (var el in tt.Elements)
        {
            var n = string.IsNullOrEmpty(el.Identifier.Text) ? $"item{i + 1}" : el.Identifier.Text;
            parts.Add($"{n}: {MapType(el.Type)}");
            i++;
        }

        return $"{{ {string.Join("; ", parts)} }}";
    }

    private static string StripNullable(string t) => t.EndsWith('?') ? t[..^1] : t;

    private static bool IsIntegerType(TypeSyntax? type)
    {
        if (type == null) return false;
        var t = StripNullable(type.ToString().Trim());
        return t is "int" or "long" or "short" or "byte" or "uint" or "ulong" or "sbyte" or "ushort";
    }

    private static readonly HashSet<string> IntMembers = new(StringComparer.Ordinal)
    {
        "Column", "Size", "Index", "TotalColumns", "RowIndex", "Count", "Length",
    };

    /// <summary>
    /// Syntax-only guess that a C# expression has an integer type, so <c>/</c> truncates.
    /// </summary>
    private bool IsIntExpr(ExpressionSyntax expr)
    {
        switch (expr)
        {
            case LiteralExpressionSyntax lit when lit.IsKind(SyntaxKind.NumericLiteralExpression):
            {
                var t = lit.Token.Text;
                if (t.Contains('.') || t.Contains('e') || t.Contains('E'))
                    return false;
                if (t.Length > 0 && t[^1] is 'f' or 'F' or 'd' or 'D' or 'm' or 'M')
                    return false;
                return true;
            }
            case IdentifierNameSyntax id:
                return _intNames.Contains(id.Identifier.Text);
            case MemberAccessExpressionSyntax ma:
                return IntMembers.Contains(ma.Name.Identifier.Text);
            case ParenthesizedExpressionSyntax par:
                return IsIntExpr(par.Expression);
            case BinaryExpressionSyntax b when b.OperatorToken.IsKind(SyntaxKind.PlusToken)
                                              || b.OperatorToken.IsKind(SyntaxKind.MinusToken)
                                              || b.OperatorToken.IsKind(SyntaxKind.AsteriskToken):
                return IsIntExpr(b.Left) && IsIntExpr(b.Right);
            case PrefixUnaryExpressionSyntax pre when pre.OperatorToken.IsKind(SyntaxKind.MinusToken):
                return IsIntExpr(pre.Operand);
            case CastExpressionSyntax cast:
                return IsIntegerType(cast.Type);
            default:
                return false;
        }
    }

    private void Error(SyntaxNode node, string message)
    {
        var loc = node.GetLocation().GetLineSpan();
        var line = loc.StartLinePosition.Line + 1;
        _diagnostics.Add($"ERROR: {_sourceRelative}:{line}: {message}");
    }

    private void EmitLine(string line)
    {
        if (string.IsNullOrEmpty(line))
        {
            _emit.AppendLine();
            return;
        }

        _emit.Append(new string(' ', _indent * 2));
        _emit.AppendLine(line);
    }

    private void Indent() => _indent++;
    private void Dedent() => _indent = Math.Max(0, _indent - 1);
}
