import React, { useState } from "react";
import {
  Badge,
  Button,
  ButtonSize,
  ButtonVariant,
  Card,
  CardContent,
  CardDescription,
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
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
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

  return (
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
            <Badge variant="success">v0.1</Badge>
          </VStack>

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
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                    <SelectItem value="insane">Insane</SelectItem>
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
                      {(item) => <ComboboxItem key={item} value={item} />}
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

          <Section title="Overlays">
            <HStack gap="md" align="center">
              <Tooltip>
                <TooltipTrigger>
                  <Button variant="secondary">Hover for tooltip</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltip anchored to trigger</TooltipContent>
              </Tooltip>

              <Popover>
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

              <Dialog>
                <DialogTrigger>
                  <Button variant="secondary">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm action</DialogTitle>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button>Confirm</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </HStack>
          </Section>

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
        </VStack>
      </div>
    </TooltipProvider>
  );
}
