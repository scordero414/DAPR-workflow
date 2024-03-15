import {
  DaprServer,
  DaprWorkflowClient,
  Task,
  TWorkflow,
  WorkflowActivityContext,
  WorkflowContext,
  WorkflowRuntime,
} from '@dapr/dapr';
import express, { Request, Response } from 'express';

export const main = async () => {
  const app = express();

  const daprHost = 'localhost';
  const daprPort = '50001';
  const workflowClient = new DaprWorkflowClient({
    daprHost,
    daprPort,
  });
  const workflowRuntime = new WorkflowRuntime({
    daprHost,
    daprPort,
  });

  const server = new DaprServer({
    serverHost: daprHost,
    serverPort: '3000',
    serverHttp: app,
  });

  interface SeatReservation {
    locationPreference: SeatTypeEnum; // 'aisle' | 'window' | 'middle';
    name: string;
    id: string;
  }

  enum SeatTypeEnum {
    aisle = 'aisle',
    window = 'window',
    middle = 'middle',
  }

  interface Seat {
    seat: string;
    available: boolean;
  }

  const seatsA: Seat[] = [
    { seat: 'A1', available: false },
    { seat: 'A2', available: false },
    { seat: 'A3', available: false },
    { seat: 'A4', available: false },
    { seat: 'A5', available: false },
    { seat: 'A6', available: false },
  ];
  const seatsB: Seat[] = [
    { seat: 'B1', available: true },
    { seat: 'B2', available: true },
    { seat: 'B3', available: true },
    { seat: 'B4', available: true },
    { seat: 'B5', available: true },
    { seat: 'B6', available: true },
  ];
  const seatsC: Seat[] = [
    { seat: 'C1', available: true },
    { seat: 'C2', available: true },
    { seat: 'C3', available: true },
    { seat: 'C4', available: true },
    { seat: 'C5', available: true },
    { seat: 'C6', available: true },
  ];

  const validateAvailableSeat = (
    _: WorkflowActivityContext,
    locationPreference: SeatTypeEnum
  ): boolean => {
    let available: boolean = false;
    // await sleep(3000);
    switch (locationPreference) {
      case SeatTypeEnum.aisle:
        available = seatsA.some((seat) => seat.available);
        break;
      case SeatTypeEnum.middle:
        available = seatsB.some((seat) => seat.available);
        break;
      case SeatTypeEnum.window:
        available = seatsC.some((seat) => seat.available);
        break;
    }

    return available;
  };

  function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const getAvailableSeats = async (
    _: WorkflowActivityContext,
    locationPreferences: SeatTypeEnum[]
  ): Promise<Seat[]> => {
    try {
      // throw new Error('Error from getAvailableSeats');
      // await sleep(3000);
      return locationPreferences
        .reduce<Seat[][]>((acc, curr) => {
          switch (curr) {
            case SeatTypeEnum.aisle:
              acc.push(seatsA.filter((seat) => seat.available));
              break;
            case SeatTypeEnum.middle:
              acc.push(seatsB.filter((seat) => seat.available));
              break;
            case SeatTypeEnum.window:
            default:
              acc.push(seatsC.filter((seat) => seat.available));
              break;
          }

          return acc;
        }, [])
        .flat();
    } catch (error) {
      console.error('Error from getAvailableSeats:', error);
      return [];
    }
  };

  const getRandomSeat = (_: WorkflowActivityContext, seats: Seat[]): Seat => {
    return seats.at(getRandomInt(0, seats.length - 1)) as Seat;
  };

  const selectSeatTask = async function (
    _: WorkflowActivityContext,
    reservation: SeatReservation
  ) {
    const areAvailableSeats = validateAvailableSeat(
      _,
      reservation.locationPreference
    );
    if (areAvailableSeats) {
      const availableSeatsByPreference = await getAvailableSeats(_, [
        reservation.locationPreference,
      ]);

      const { seat }: Seat = getRandomSeat(_, availableSeatsByPreference);

      return `The Selected seat for this flight is: ${seat}`;
    }

    const availableSeats = await getAvailableSeats(
      _,
      Object.keys(SeatTypeEnum).filter(
        (locationPreference) =>
          locationPreference !== reservation.locationPreference
      ) as SeatTypeEnum[]
    );

    if (availableSeats.length === 0) {
      return 'There are not any seat available in this flight.';
    }

    const { seat }: Seat = getRandomSeat(_, availableSeats);

    return `The Random Selected seat for this flight is: ${seat}, because there are not any seat available in your location preference.`;
  };

  const sequence: TWorkflow = async function* (
    ctx: WorkflowContext,
    reservation: SeatReservation
  ): any {
    const areAvailableSeats = yield ctx.callActivity(
      validateAvailableSeat,
      reservation.locationPreference
    );
    if (areAvailableSeats) {
      const availableSeatsByPreference = yield ctx.callActivity(
        getAvailableSeats,
        [reservation.locationPreference]
      );

      const { seat }: Seat = yield ctx.callActivity(
        getRandomSeat,
        availableSeatsByPreference
      );

      return `The Selected seat for this flight is: ${seat}`;
    }

    const availableSeats = yield ctx.callActivity(
      getAvailableSeats,
      Object.keys(SeatTypeEnum).filter(
        (locationPreference) =>
          locationPreference !== reservation.locationPreference
      )
    );

    if (availableSeats.length === 0) {
      return 'There are not any seat available in this flight.';
    }

    const { seat }: Seat = yield ctx.callActivity(
      getRandomSeat,
      availableSeats
    );

    return `The Random Selected seat for this flight is: ${seat}, because there are not any seat available in your location preference.`;
  };

  const fanInFanOutSequence = async function* (
    ctx: WorkflowContext,
    reservations: SeatReservation[]
  ) {
    const results: string[] = yield ctx.whenAll(
      reservations.map((reservation) =>
        ctx.callActivity(selectSeatTask, reservation)
      )
    );

    const tasks: Task<any>[] = [];
    const approvalEvent = ctx.waitForExternalEvent('approval_received');
    const timeoutEvent = ctx.createTimer(20);
    // yield sleep(10000);
    tasks.push(approvalEvent);
    tasks.push(timeoutEvent);
    const winner: unknown = yield ctx.whenAny(tasks);

    console.log('Waiting for approval or timeout!!!!', winner);

    if (winner == timeoutEvent) {
      return 'Cancelled';
    }

    const approvalDetails = approvalEvent.getResult();
    console.log(`Approved by ${approvalDetails.approver}`);
    return results;
  };

  workflowRuntime
    .registerWorkflow(sequence)
    .registerWorkflow(fanInFanOutSequence)
    .registerActivity(getAvailableSeats)
    .registerActivity(validateAvailableSeat)
    .registerActivity(getRandomSeat)
    .registerActivity(selectSeatTask);

  await workflowRuntime.start();
  await server.start(); // Start the server

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  app.post('/auto-seat-reservation', async (req: Request, res: Response) => {
    const seatReservation = req.body as SeatReservation;

    try {
      const id = await workflowClient.scheduleNewWorkflow(
        sequence,
        seatReservation
      );
      console.log(`Orchestration scheduled with ID: ${id}`);

      // Wait for orchestration completion
      const state = await workflowClient.waitForWorkflowCompletion(
        id,
        undefined,
        1
      );

      console.log(
        `Orchestration completed! Result: ${state?.serializedOutput}`
      );

      // res.send({ msg: 'Workflow received' });
    } catch (error) {
      console.error('Error scheduling or waiting for orchestration:', error);
      // res.send({ msg: 'Workflow is not finished on timeout limit' });
    }

    await workflowClient.stop();
    await workflowRuntime.stop();
    res.send({ msg: 'Workflow received' });
  });

  app.post('/multi-seat-reservation', async (req: Request, res: Response) => {
    const seatReservations = req.body.seats as SeatReservation[];

    try {
      const id = await workflowClient.scheduleNewWorkflow(
        fanInFanOutSequence,
        seatReservations
      );
      console.log(`Orchestration scheduled with ID: ${id}`);

      // Wait for orchestration completion
      const state = await workflowClient.waitForWorkflowCompletion(
        id,
        undefined,
        60
      );

      console.log(
        `Orchestration completed! Result: ${state?.serializedOutput}`
      );

      // res.send({ msg: 'Workflow received' });
    } catch (error) {
      console.error('Error scheduling or waiting for orchestration:', error);
      // res.send({ msg: 'Workflow is not finished on timeout limit' });
    }

    await workflowClient.stop();
    await workflowRuntime.stop();
    res.send({ msg: 'Workflow received' });
  });

  app.post('/confirm-reservation', async (req: Request, res: Response) => {
    const confirmationRes = req.body as any;

    try {
      await workflowClient.raiseEvent(
        confirmationRes.workflowId,
        'approval_received',
        confirmationRes
      );

      // res.send({ msg: 'Workflow received' });
    } catch (error) {
      console.error('Error scheduling or waiting for orchestration:', error);
      // res.send({ msg: 'Workflow is not finished on timeout limit' });
    }

    res.send({ msg: 'Workflow received' });
  });
};

main().catch(console.log);
