import React, { useState } from "react";
import {
  Badge,
  Button,
  ButtonSize,
  ButtonVariant,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogBody,
  Field,
  Grid,
  Heading,
  HStack,
  IconButton,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  selectItemStyle,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Sparkline,
  AreaChart,
  Spacer,
  Spinner,
  Stack,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  VStack,
} from "./components/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  colors,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Progress,
  ScrollArea,
  Expandable,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
  SidebarSeparator,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToastProvider,
  useToast,
} from "./components/ui";

const BUTTON_VARIANTS: ButtonVariant[] = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
];

const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg", "icon"];

const BADGE_VARIANTS = ["default", "secondary", "destructive", "success", "outline"] as const;

const COMMANDS = ["Profile", "Settings", "Log out", "New project", "Open recent"];

const CHART_TREND = [12, 18, 14, 22, 30, 26, 34, 40, 38, 46, 52, 48, 60];
const CHART_DENSITY = Array.from({ length: 40 }, (_, i) =>
  Math.round(20 + 30 * Math.abs(Math.sin(i / 3)) + (i % 5) * 4),
);

function ToastDemo() {
  const { toast } = useToast();

  return (
    <HStack gap="sm" align="center">
      <Button size="sm" onClick={() => toast({ title: "Default toast", description: "Hello from GPUIX UI" })}>
        Default
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => toast({ title: "Saved", description: "Changes applied", variant: "success" })}
      >
        Success
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => toast({ title: "Error", description: "Something failed", variant: "destructive" })}
      >
        Destructive
      </Button>
    </HStack>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card style={{ width: "100%" }}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Playground() {
  const [clicks, setClicks] = useState(0);
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(false);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [difficulty, setDifficulty] = useState("hard");
  const [fruit, setFruit] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progress, setProgress] = useState(40);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [lastAction, setLastAction] = useState("");
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [sheetLeftOpen, setSheetLeftOpen] = useState(false);
  const [sheetRightOpen, setSheetRightOpen] = useState(false);

  return (
    <ToastProvider>
      <TooltipProvider>
        <div
        style={{
          flexGrow: 1,
          flexBasis: 0,
          minHeight: 0,
          backgroundColor: "#0c0e12",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflow: "scroll",
          padding: 24,
        }}
      >
        <VStack gap="xl" align="center" style={{ width: "100%", maxWidth: 860 }}>
          <VStack gap="sm" align="center">
            <Heading level={1}>GPUIX UI — Test Page</Heading>
            <Text muted>Exercise every component in the design system</Text>
            <Badge variant="success">v0.2</Badge>
          </VStack>

          <Tabs defaultValue="inputs">
            <TabsList>
              <TabsTrigger value="inputs">Inputs</TabsTrigger>
              <TabsTrigger value="overlays">Overlays</TabsTrigger>
              <TabsTrigger value="data">Layout &amp; Data</TabsTrigger>
              <TabsTrigger value="menus">Menus</TabsTrigger>
            </TabsList>
            <TabsContent value="inputs">
          <Section title="Buttons">
            <VStack gap="md">
              <div>
                <Text size="sm" muted style={{ marginBottom: 8 }}>
                  Variants
                </Text>
                <HStack gap="sm" wrap>
                  {BUTTON_VARIANTS.map((variant) => (
                    <Button key={variant} variant={variant} onClick={() => setClicks((c) => c + 1)}>
                      {variant}
                    </Button>
                  ))}
                </HStack>
              </div>

              <div>
                <Text size="sm" muted style={{ marginBottom: 8 }}>
                  Sizes
                </Text>
                <HStack gap="sm" align="center">
                  {BUTTON_SIZES.map((size) => (
                    <Button key={size} size={size}>
                      {size === "icon" ? "★" : size}
                    </Button>
                  ))}
                </HStack>
              </div>

              <div>
                <Text size="sm" muted style={{ marginBottom: 8 }}>
                  States
                </Text>
                <HStack gap="sm" align="center">
                  <Button disabled>Disabled</Button>
                  <Button loading>Loading</Button>
                  <Button variant="outline" disabled>
                    Disabled outline
                  </Button>
                  <IconButton>
                    <Text>↻</Text>
                  </IconButton>
                  <Button onClick={() => setClicks((c) => c + 1)}>Click me ({clicks})</Button>
                </HStack>
              </div>
            </VStack>
          </Section>

          <Section title="Badges & Typography">
            <VStack gap="md">
              <HStack gap="sm" wrap>
                {BADGE_VARIANTS.map((variant) => (
                  <Badge key={variant} variant={variant}>
                    {variant}
                  </Badge>
                ))}
              </HStack>
              <Stack gap="xs">
                <Heading level={1}>Heading 1</Heading>
                <Heading level={2}>Heading 2</Heading>
                <Heading level={3}>Heading 3</Heading>
                <Heading level={4}>Heading 4</Heading>
                <Text>Body text (md)</Text>
                <Text size="sm" muted>
                  Small muted text
                </Text>
                <Text size="lg" weight="bold">
                  Large bold text
                </Text>
              </Stack>
            </VStack>
          </Section>

          <Section title="Form controls">
            <VStack gap="md">
              <Field label="Text input" description="Controlled value is echoed below.">
                <Input
                  placeholder="Type something..."
                  value={text}
                  onValueChange={setText}
                />
              </Field>
              <Text size="sm" muted>
                You typed: {text || "(empty)"}
              </Text>

              <Field label="Textarea">
                <Textarea placeholder="Multi-line notes..." value={notes} onValueChange={setNotes} />
              </Field>

              <Field label="With error" error="This field is required.">
                <Input placeholder="Invalid input" />
              </Field>

              <HStack gap="lg" align="center">
                <HStack gap="sm" align="center">
                  <Checkbox checked={checked} onCheckedChange={setChecked} />
                  <Label>Checkbox ({checked ? "on" : "off"})</Label>
                </HStack>

                <HStack gap="sm" align="center">
                  <Switch checked={toggled} onCheckedChange={setToggled} />
                  <Label>Switch ({toggled ? "on" : "off"})</Label>
                </HStack>
              </HStack>
            </VStack>
          </Section>

          <Section title="Selection">
            <VStack gap="md">
              <Field label="Select">
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy" style={selectItemStyle}>Easy</SelectItem>
                    <SelectItem value="hard" style={selectItemStyle}>Hard</SelectItem>
                    <SelectItem value="expert" style={selectItemStyle}>Expert</SelectItem>
                    <SelectItem value="insane" style={selectItemStyle}>Insane</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Text size="sm" muted>
                Selected: {difficulty}
              </Text>

              <Field label="Combobox">
                <Combobox
                  value={fruit}
                  onValueChange={(value) => setFruit(typeof value === "string" ? value : null)}
                  items={["Apple", "Banana", "Cherry", "Durian"]}
                >
                  <ComboboxTrigger>
                    <ComboboxValue placeholder="Pick a fruit" />
                  </ComboboxTrigger>
                  <ComboboxContent>
                    <ComboboxInput placeholder="Search..." />
                    <ComboboxList>
                      {(item) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>

              <Text size="sm" muted>
                Picked: {fruit ?? "(none)"}
              </Text>
            </VStack>
          </Section>

          <Section title="Tabs">
            <Tabs defaultValue="one">
              <TabsList>
                <TabsTrigger value="one">One</TabsTrigger>
                <TabsTrigger value="two">Two</TabsTrigger>
                <TabsTrigger value="three">Three</TabsTrigger>
              </TabsList>
              <TabsContent value="one">
                <Text>First panel content.</Text>
              </TabsContent>
              <TabsContent value="two">
                <Text>Second panel content.</Text>
              </TabsContent>
              <TabsContent value="three">
                <Text>Third panel content.</Text>
              </TabsContent>
            </Tabs>
          </Section>

          </TabsContent>
          <TabsContent value="overlays">
          <Section title="Overlays">
            <HStack gap="md" align="center">
              <Tooltip open={tipOpen} onOpenChange={setTipOpen}>
                <TooltipTrigger>
                  <Button variant="secondary">Hover for tooltip</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltip anchored to trigger</TooltipContent>
              </Tooltip>

              <Button variant="outline" onClick={() => setTipOpen((o) => !o)}>
                Toggle tooltip
              </Button>

              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger>
                  <Button variant="secondary">Open popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <VStack gap="sm">
                    <Text weight="semibold">Popover</Text>
                    <Text muted size="sm">
                      Positioned with the native anchored layer.
                    </Text>
                    <Button size="sm">Action</Button>
                  </VStack>
                </PopoverContent>
              </Popover>
              <Button variant="outline" onClick={() => setPopoverOpen((o) => !o)}>
                Toggle popover
              </Button>

              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger>
                  <Button variant="secondary">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm action</DialogTitle>
                  </DialogHeader>
                  <DialogBody>
                    <Text muted>This action cannot be undone.</Text>
                  </DialogBody>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button variant="outline" onClick={() => setDialogOpen((o) => !o)}>
                Toggle dialog
              </Button>
            </HStack>
          </Section>

          <Section title="Modal & Sheet">
          <VStack gap="md" align="start">
            <HStack gap="md" align="center">
              <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
                <DialogTrigger>
                  <Button variant="secondary">Fullscreen modal</Button>
                </DialogTrigger>
                <DialogContent size="fullscreen">
                  <div
                    style={{
                      display: "flex",
                      flexGrow: 1,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Card style={{ width: 420 }}>
                      <CardHeader>
                        <CardTitle>Fullscreen modal</CardTitle>
                        <CardDescription>
                          Full-window surface — GPUIX has no backdrop blur.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Text muted>Click outside or press Escape to close.</Text>
                      </CardContent>
                      <CardFooter>
                        <Button variant="outline" onClick={() => setFullscreenOpen(false)}>
                          Close
                        </Button>
                      </CardFooter>
                    </Card>
                  </div>
                </DialogContent>
              </Dialog>

              <Sheet side="left" open={sheetLeftOpen} onOpenChange={setSheetLeftOpen}>
                <SheetTrigger>
                  <Button variant="outline">Left sheet</Button>
                </SheetTrigger>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Left sheet</SheetTitle>
                    <SheetDescription>Slide-over anchored to the trigger edge.</SheetDescription>
                  </SheetHeader>
                  <SheetFooter>
                    <Button variant="outline" onClick={() => setSheetLeftOpen(false)}>
                      Close
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>

              <Sheet side="right" open={sheetRightOpen} onOpenChange={setSheetRightOpen}>
                <SheetTrigger>
                  <Button variant="outline">Right sheet</Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Right sheet</SheetTitle>
                    <SheetDescription>Another edge variant.</SheetDescription>
                  </SheetHeader>
                  <SheetFooter>
                    <Button variant="outline" onClick={() => setSheetRightOpen(false)}>
                      Close
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </HStack>
          </VStack>
        </Section>

          </TabsContent>
          <TabsContent value="data">
        <Section title="Layout & feedback">
            <VStack gap="md">
              <Grid columns={3} gap="md">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <Card key={n}>
                    <CardContent>
                      <Text>Grid cell {n}</Text>
                    </CardContent>
                  </Card>
                ))}
              </Grid>

              <Separator />

              <HStack gap="lg" align="center">
                <Spinner size={20} />
                <Skeleton width={140} height={14} />
                <Skeleton width={100} height={14} />
                <Skeleton width={60} height={36} radius={8} />
              </HStack>

              <Spacer />
            </VStack>
          </Section>
        <Section title="Alert">
          <VStack gap="sm">
            <Alert variant="default" title="Heads up">
              This is an informational alert.
            </Alert>
            <Alert variant="success" title="Saved">
              Your changes were saved.
            </Alert>
            <Alert variant="destructive" title="Something went wrong">
              The operation failed.
            </Alert>
            <Alert variant="warning" title="Careful">
              This action cannot be undone.
            </Alert>
          </VStack>
        </Section>

        <Section title="Progress">
          <VStack gap="sm">
            <Progress value={progress} />
            <HStack gap="sm" align="center">
              <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
                -
              </Button>
              <Text size="sm" muted>
                {progress}%
              </Text>
              <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
                +
              </Button>
            </HStack>
            <Progress value={33} indicatorColor="#6ee7b7" />
            <Progress value={66} indicatorColor="#fbbf24" />
          </VStack>
        </Section>

        <Section title="Accordion">
          <Accordion type="single" collapsible defaultValue="a">
            <AccordionItem value="a">
              <AccordionTrigger>
                <Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>
                  What is GPUIX UI?
                </Button>
              </AccordionTrigger>
              <AccordionContent>
                A shadcn-style component system built natively on GPUIX.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>
                <Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>
                  Is it headless?
                </Button>
              </AccordionTrigger>
              <AccordionContent>
                Behavior comes from GPUIX primitives; styling is composed per component.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="c">
              <AccordionTrigger>
                <Button variant="ghost" style={{ width: "100%", justifyContent: "flex-start" }}>
                  Can I customize?
                </Button>
              </AccordionTrigger>
              <AccordionContent>
                Yes — every component is source-first and owned by your app.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>

        <Section title="Expandable (avoid nested scroll)">
          <Expandable
            testId="expandable-demo"
            preview={
              <Text size="sm" muted>
                Long beatmap notes are collapsed here. GPUIX does not support a scroll viewport inside another scroller.
              </Text>
            }
          >
            <VStack gap="xs">
              {Array.from({ length: 12 }).map((_, i) => (
                <Text key={i} size="sm">
                  Note line {i + 1}: timing adjustment for measure {i + 4}
                </Text>
              ))}
            </VStack>
          </Expandable>
        </Section>

        <Section title="ScrollArea (sole vertical scroller)">
          <Text size="sm" muted style={{ marginBottom: 8 }}>
            Use as the only vertical scroll parent in a subtree — not inside this page scroll.
          </Text>
          <ScrollArea style={{ height: 160, flexGrow: 0, flexBasis: 160 }}>
            <VStack gap="xs" style={{ padding: 12 }}>
              {Array.from({ length: 20 }).map((_, i) => (
                <Text key={i} size="sm">
                  Scrollable row {i + 1}
                </Text>
              ))}
            </VStack>
          </ScrollArea>
        </Section>

        <Section title="Table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Blue Zenith", "Insane", "Live"],
                ["Genryuu", "Expert", "Stored"],
                ["Fracture", "Hard", "Local"],
              ].map(([name, diff, status]) => (
                <TableRow key={name}>
                  <TableCell>{name}</TableCell>
                  <TableCell>{diff}</TableCell>
                  <TableCell>{status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Sidebar">
          <HStack gap="md" align="start" style={{ width: "100%", height: 280 }}>
            <Sidebar collapsed={sidebarCollapsed}>
              <SidebarHeader>
                <Text weight="bold">Roxysu</Text>
              </SidebarHeader>
              <SidebarContent>
                <SidebarItem active icon={<Text>▦</Text>}>
                  <SidebarLabel>Dashboard</SidebarLabel>
                </SidebarItem>
                <SidebarItem icon={<Text>▤</Text>}>
                  <SidebarLabel>Library</SidebarLabel>
                </SidebarItem>
                <SidebarItem icon={<Text>◎</Text>}>
                  <SidebarLabel>Analyzer</SidebarLabel>
                </SidebarItem>
                <SidebarSeparator />
                <SidebarItem icon={<Text>⚙</Text>}>
                  <SidebarLabel>Settings</SidebarLabel>
                </SidebarItem>
              </SidebarContent>
              <SidebarFooter>
                <SidebarItem onClick={() => setSidebarCollapsed((c) => !c)} icon={<Text>{sidebarCollapsed ? "»" : "«"}</Text>}>
                  <SidebarLabel>{sidebarCollapsed ? "Expand" : "Collapse"}</SidebarLabel>
                </SidebarItem>
              </SidebarFooter>
            </Sidebar>
            <VStack gap="md" style={{ flexGrow: 1 }}>
              <Text muted>Content area beside the sidebar. Toggle collapse in the footer.</Text>
              <Text size="sm" muted>
                Collapsed: {sidebarCollapsed ? "yes" : "no"}
              </Text>
            </VStack>
          </HStack>
        </Section>

        <Section title="Charts">
          <VStack gap="md">
            <div>
              <Text size="sm" muted style={{ marginBottom: 8 }}>
                Sparkline
              </Text>
              <HStack gap="md" align="center">
                <Sparkline data={CHART_TREND} width={160} height={40} />
                <Sparkline
                  data={CHART_DENSITY}
                  width={160}
                  height={40}
                  stroke={colors.destructive}
                  fill="rgba(239, 68, 68, 0.15)"
                />
              </HStack>
            </div>
            <div>
              <Text size="sm" muted style={{ marginBottom: 8 }}>
                Area chart
              </Text>
              <AreaChart data={CHART_DENSITY} width={320} height={96} grid />
            </div>
          </VStack>
        </Section>

          </TabsContent>
          <TabsContent value="menus">
        <Section title="DropdownMenu">
          <VStack gap="sm" align="start">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button variant="secondary">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setLastAction("edit")}>
                  <Text>Edit</Text>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLastAction("duplicate")}>
                  <Text>Duplicate</Text>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setLastAction("delete")}>
                  <Text>Destructive</Text>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Text size="sm" muted>
              Last action: {lastAction || "(none)"}
            </Text>
          </VStack>
        </Section>

        <Section title="ContextMenu">
          <VStack gap="sm" align="start">
            <ContextMenu>
              <ContextMenuTrigger>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 120,
                    width: "100%",
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    color: colors.mutedForeground,
                  }}
                >
                  <Text>Right-click (or click) here</Text>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => setLastAction("copy")}>
                  <Text>Copy</Text>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => setLastAction("paste")}>
                  <Text>Paste</Text>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => setLastAction("rename")}>
                  <Text>Rename</Text>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <Text size="sm" muted>
              Last action: {lastAction || "(none)"}
            </Text>
          </VStack>
        </Section>

        <Section title="Command">
          <VStack gap="sm" align="start">
            <Button variant="secondary" onClick={() => setCommandOpen(true)}>
              Open command palette
            </Button>
            <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
              <Command items={COMMANDS} onValueChange={() => setCommandOpen(false)}>
                <CommandInput placeholder="Type a command..." />
                <CommandList>
                  {(item) => (
                    <CommandItem key={item} value={item}>
                      {item}
                    </CommandItem>
                  )}
                </CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
              </Command>
            </CommandDialog>
          </VStack>
        </Section>

        <Section title="Toast">
          <ToastDemo />
        </Section>

          </TabsContent>
        </Tabs>
        </VStack>
      </div>
      </TooltipProvider>
    </ToastProvider>
  );
}
